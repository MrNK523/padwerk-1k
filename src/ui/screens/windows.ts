import { LEVELS16_TYPES } from '../../core/levels16';
import { padName, type SampleMeta } from '../../core/model';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import type { FrameBuffer } from '../display/framebuffer';
import { drawSoftkeys, drawWindowFrame, formatTune, pad2, step, stepEnum, type AppCtx, type Screen } from './screen';

/** Gemeinsame Grundlage: WINDOW schließt jedes Fenster (wie am Gerät). */
export abstract class Window implements Screen {
  abstract readonly id: string;
  constructor(protected ctx: AppCtx) {}
  abstract softkeys(): readonly string[];
  abstract render(fb: FrameBuffer): void;
  protected abstract handle(e: HwEvent): boolean;
  onEvent(e: HwEvent): boolean {
    if (e.kind === 'button' && e.down && (e.id === 'WINDOW' || e.id === 'MAIN')) {
      this.ctx.closeWindow();
      return e.id === 'WINDOW';
    }
    return this.handle(e);
  }
}

// ---------------------------------------------------------------------------
// Sample-Liste: alphabetisch, Auswahl mit Wheel/Cursor, übernehmen mit F4
// ---------------------------------------------------------------------------
export class SampleListWindow extends Window {
  readonly id = 'sample-list';
  private index: number;
  private items: (SampleMeta | null)[];

  constructor(ctx: AppCtx, current: string | null, private onPick: (id: string | null) => void) {
    super(ctx);
    this.items = [null, ...ctx.store.samplesSorted()];
    this.index = Math.max(0, this.items.findIndex((s) => (s?.id ?? null) === current));
  }

  softkeys() { return ['', '', '', 'WÄHLEN', '', 'ABBR.']; }

  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Sample-Liste');
    const rows = 4;
    const first = Math.min(Math.max(0, this.index - 1), Math.max(0, this.items.length - rows));
    for (let r = 0; r < rows; r++) {
      const i = first + r;
      const s = this.items[i];
      if (i >= this.items.length) break;
      const name = s ? s.name : '(kein Sample)';
      const info = s ? `${s.channels === 2 ? 'ST' : 'MO'} ${(s.frames / s.sampleRate).toFixed(2)}s` : '';
      const line = `${name.padEnd(16)} ${info}`.padEnd(36);
      fb.text(x, y + r * CELL_H, line, i === this.index);
    }
    fb.text(x + 30 * CELL_W, y - CELL_H - 2, `${this.items.length - 1}`.padStart(4));
    drawSoftkeys(fb, this.softkeys());
  }

  protected handle(e: HwEvent): boolean {
    if (e.kind === 'wheel') { this.move(e.delta * (this.ctx.coarse() ? 10 : 1)); return true; }
    if (e.kind !== 'button' || !e.down) return false;
    if (e.id === 'CURSOR_UP') { this.move(-1); return true; }
    if (e.id === 'CURSOR_DOWN') { this.move(1); return true; }
    if (e.id === 'F4') { this.onPick(this.items[this.index]?.id ?? null); this.ctx.closeWindow(); return true; }
    if (e.id === 'F6') { this.ctx.closeWindow(); return true; }
    return false;
  }

  private move(d: number): void {
    this.index = Math.min(this.items.length - 1, Math.max(0, this.index + d));
  }
}

// ---------------------------------------------------------------------------
// LAYER-Fenster: drei Layer pro Pad mit Sample, Pegel, Tune, Velocity-Bereich
// ---------------------------------------------------------------------------
export class LayerWindow extends Window {
  readonly id = 'layer';
  private row = 0;
  private col = 0;
  private static COLS = ['SAMPLE', 'CH', 'LEV', 'TUNE', 'V.LO', 'V.HI'] as const;

  constructor(ctx: AppCtx, private pad: number) { super(ctx); }

  softkeys() { return ['', 'CP.PAD', '', 'CLOSE', '', '']; }

  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, `Layer  Pad ${padName(this.pad)}`);
    const p = this.ctx.store.currentProgram.pads[this.pad]!;
    fb.text(x, y, '  SAMPLE       CH LEV TUNE    LO  HI');
    p.layers.forEach((l, r) => {
      const ry = y + (r + 1) * CELL_H;
      const m = this.ctx.store.sample(l.sampleId);
      const name = m?.name ?? '(kein)';
      fb.text(x, ry, `${r + 1}`);
      const chop = m?.chopOn && l.chop > 0 ? pad2(l.chop) : '--';
      const cells = [name.slice(0, 12).padEnd(12), chop, String(l.level).padStart(3), formatTune(l.tune), String(l.rangeLo).padStart(3), String(l.rangeHi).padStart(3)];
      const xs = [2, 15, 18, 22, 29, 33];
      cells.forEach((c, ci) => fb.text(x + xs[ci]! * CELL_W, ry, c, r === this.row && ci === this.col));
    });
    drawSoftkeys(fb, this.softkeys());
  }

  protected handle(e: HwEvent): boolean {
    const store = this.ctx.store;
    const pid = store.currentProgram.id;
    const layer = this.row as 0 | 1 | 2;
    const l = store.currentProgram.pads[this.pad]!.layers[layer];
    if (e.kind === 'wheel') {
      const d = e.delta * (this.ctx.coarse() ? 10 : 1);
      switch (LayerWindow.COLS[this.col]) {
        case 'SAMPLE': {
          const list = [null, ...store.samplesSorted().map((s) => s.id)];
          const i = Math.max(0, list.indexOf(l.sampleId));
          store.updateLayer(pid, this.pad, layer, { sampleId: list[Math.min(list.length - 1, Math.max(0, i + e.delta))] ?? null });
          break;
        }
        case 'CH': {
          const m = store.sample(l.sampleId);
          if (m?.chopOn) store.updateLayer(pid, this.pad, layer, { chop: step(l.chop, e.delta, 0, m.chops.length) });
          break;
        }
        case 'LEV': store.updateLayer(pid, this.pad, layer, { level: step(l.level, d, 0, 100) }); break;
        case 'TUNE': store.updateLayer(pid, this.pad, layer, { tune: step(l.tune, this.ctx.ui.held.has('SHIFT') ? e.delta / 100 : e.delta, -36, 36) }); break;
        case 'V.LO': store.updateLayer(pid, this.pad, layer, { rangeLo: step(l.rangeLo, d, 0, l.rangeHi) }); break;
        case 'V.HI': store.updateLayer(pid, this.pad, layer, { rangeHi: step(l.rangeHi, d, l.rangeLo, 127) }); break;
      }
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(2, this.row + 1); return true;
      case 'CURSOR_LEFT': this.col = Math.max(0, this.col - 1); return true;
      case 'CURSOR_RIGHT': this.col = Math.min(LayerWindow.COLS.length - 1, this.col + 1); return true;
      case 'F2': this.ctx.openWindow(new CopyPadWindow(this.ctx, this.pad)); return true;
      case 'F4': this.ctx.closeWindow(); return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Copy Pad: alle Parameter eines Pads auf ein anderes kopieren
// ---------------------------------------------------------------------------
export class CopyPadWindow extends Window {
  readonly id = 'copy-pad';
  private target: number;
  constructor(ctx: AppCtx, private from: number) { super(ctx); this.target = (from + 1) % 64; }
  softkeys() { return ['', '', '', 'ABBR.', 'AUSF.', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Pad kopieren');
    fb.text(x, y + CELL_H, `Von Pad ${padName(this.from)}  nach Pad `);
    fb.text(x + 26 * CELL_W, y + CELL_H, padName(this.target), true);
    fb.text(x, y + 3 * CELL_H, 'Ziel: Wheel oder Pad anschlagen');
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'wheel') { this.target = step(this.target, e.delta, 0, 63); return true; }
    if (e.kind === 'pad' && e.down) { this.target = this.ctx.ui.bank * 16 + e.pad; return true; }
    if (e.kind !== 'button' || !e.down) return false;
    if (e.id === 'F4') { this.ctx.closeWindow(); return true; }
    if (e.id === 'F5') {
      this.ctx.store.copyPad(this.ctx.store.currentProgram.id, this.from, [this.target]);
      this.ctx.flash(`${padName(this.from)} → ${padName(this.target)} kopiert`);
      this.ctx.closeWindow();
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Program-Liste: wechseln, neu, kopieren
// ---------------------------------------------------------------------------
export class ProgramListWindow extends Window {
  readonly id = 'program-list';
  private index: number;
  constructor(ctx: AppCtx) {
    super(ctx);
    this.index = ctx.store.state.programs.findIndex((p) => p.id === ctx.store.state.currentProgramId);
  }
  softkeys() { return ['', '', 'NEU', 'CLOSE', 'KOPIE', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Program-Liste');
    const list = this.ctx.store.state.programs;
    const rows = 4;
    const first = Math.min(Math.max(0, this.index - 1), Math.max(0, list.length - rows));
    for (let r = 0; r < rows && first + r < list.length; r++) {
      const i = first + r;
      fb.text(x, y + r * CELL_H, `${pad2(i + 1)}-${list[i]!.name}`.padEnd(36), i === this.index);
    }
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const store = this.ctx.store;
    const list = store.state.programs;
    const pick = () => { const p = list[this.index]; if (p) store.setCurrentProgram(p.id); };
    if (e.kind === 'wheel') { this.index = step(this.index, e.delta, 0, list.length - 1); pick(); return true; }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.index = step(this.index, -1, 0, list.length - 1); pick(); return true;
      case 'CURSOR_DOWN': this.index = step(this.index, 1, 0, list.length - 1); pick(); return true;
      case 'F3': { const p = store.newProgram(); if (p) { store.setCurrentProgram(p.id); this.index = list.length - 1; } return true; }
      case 'F5': { const p = store.copyProgram(store.state.currentProgramId); if (p) { store.setCurrentProgram(p.id); this.index = list.length - 1; } return true; }
      case 'F4': this.ctx.closeWindow(); return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 16 Levels zuweisen (Taste 16 LEVELS)
// ---------------------------------------------------------------------------
export class Levels16Window extends Window {
  readonly id = 'levels16';
  private row = 0;
  constructor(ctx: AppCtx) {
    super(ctx);
    ctx.ui.levels16.sourcePad = ctx.ui.selectedPad;
  }
  softkeys() { return ['', '', '', 'CLOSE', 'EIN', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, '16 Levels zuweisen');
    const s = this.ctx.ui.levels16;
    const name = this.ctx.store.sample(this.ctx.store.currentProgram.pads[s.sourcePad]?.layers[0].sampleId ?? null)?.name ?? '';
    fb.text(x, y, 'Pad:');
    fb.text(x + 6 * CELL_W, y, padName(s.sourcePad), this.row === 0);
    fb.text(x + 10 * CELL_W, y, name);
    fb.text(x, y + CELL_H, 'Typ:');
    fb.text(x + 6 * CELL_W, y + CELL_H, s.type.padEnd(8), this.row === 1);
    if (s.type === 'TUNE') {
      fb.text(x, y + 2 * CELL_H, 'Originalton auf Pad:');
      fb.text(x + 21 * CELL_W, y + 2 * CELL_H, pad2(s.originalKeyPad + 1), this.row === 2);
    }
    fb.text(x, y + 3 * CELL_H, 'Pad anschlagen wählt die Quelle');
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const s = this.ctx.ui.levels16;
    const rows = s.type === 'TUNE' ? 3 : 2;
    if (e.kind === 'pad' && e.down) {
      if (this.row === 2) s.originalKeyPad = e.pad;
      else s.sourcePad = this.ctx.ui.bank * 16 + e.pad;
      return false; // Pad klingt zur Kontrolle
    }
    if (e.kind === 'wheel') {
      if (this.row === 0) s.sourcePad = step(s.sourcePad, e.delta, 0, 63);
      else if (this.row === 1) s.type = stepEnum(LEVELS16_TYPES, s.type, e.delta);
      else s.originalKeyPad = step(s.originalKeyPad, e.delta, 0, 15);
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(rows - 1, this.row + 1); return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': this.ctx.ui.levels16On = true; this.ctx.closeWindow(); this.ctx.flash('16 Levels an'); return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Nach dem Laden: Sample auf ein Pad legen (JJOS2XL Load-Option „Assign to Pad“)
// ---------------------------------------------------------------------------
export class AssignToPadWindow extends Window {
  readonly id = 'assign-pad';
  private target: number;
  constructor(ctx: AppCtx, private queue: SampleMeta[], private onDone?: () => void) {
    super(ctx);
    this.target = ctx.ui.selectedPad;
  }
  softkeys() { return ['', '', '', 'NEIN', 'JA', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Auf Pad legen');
    const s = this.queue[0];
    fb.text(x, y, `Sample: ${s?.name ?? ''}`);
    fb.text(x, y + CELL_H, 'Pad:');
    fb.text(x + 6 * CELL_W, y + CELL_H, padName(this.target), true);
    fb.text(x, y + 3 * CELL_H, `Pad anschlagen oder Wheel  (${this.queue.length} offen)`.slice(0, 36));
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad' && e.down) { this.target = this.ctx.ui.bank * 16 + e.pad; return true; }
    if (e.kind === 'wheel') { this.target = step(this.target, e.delta, 0, 63); return true; }
    if (e.kind !== 'button' || !e.down) return false;
    if (e.id === 'F5' || e.id === 'F4') {
      const s = this.queue.shift();
      if (e.id === 'F5' && s) {
        const store = this.ctx.store;
        store.updateLayer(store.currentProgram.id, this.target, 0, { sampleId: s.id });
        this.ctx.ui.selectedPad = this.target;
        this.ctx.flash(`${s.name} → ${padName(this.target)}`);
        this.target = Math.min(63, this.target + 1);
      }
      if (this.queue.length === 0) { this.ctx.closeWindow(); this.onDone?.(); }
      return true;
    }
    return false;
  }
}
