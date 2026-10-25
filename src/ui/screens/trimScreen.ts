/**
 * TRIM-Modus (MODE + PAD 6) nach JJOS2XL: Start/Ende/Loop, Non-Destructive Chop (32 Chops),
 * destruktives Schneiden in Regionen (F5 CHOP) und das Sample-Edit-Fenster.
 * Kennt nur Hardware-Ereignisse; Änderungen laufen über den Store, Vorhören über AppCtx.
 */
import { equalChops, MAX_CHOPS, MAX_REGIONS, padName, type LoopMode, type SampleMeta } from '../../core/model';
import type { PlayRegion } from '../../dsp/sampler';
import { sliceEqual } from '../../dsp/sampleEdit';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import { LCD_W, type FrameBuffer } from '../display/framebuffer';
import { drawWave, maxZoom, viewAround, type WaveMarker } from '../display/waveform';
import { drawSoftkeys, step, stepEnum, type AppCtx, type Screen } from './screen';
import {
  AutoSliceWindow, ExtractWindow, FineWindow, NewChopProgramWindow, SampleEditWindow, SampleWindow, SHIFT_EDITS,
} from './sampleWindows';

export type TrimField = 'sample' | 'chop' | 'chopNo' | 'region' | 'st' | 'lp' | 'lock' | 'endKind' | 'end' | 'loopMode';
type Page = 'trim' | 'chop';

const LOOP_MODES: readonly LoopMode[] = ['FWD', 'ALT', 'XFADE'];
export const LOCK = '⚿';
export const UNLOCK = '○';
/** ANNAHME A-29: Vorhör-Ausschnitte der Pads 9–12 und SHIFT + Pad im Chop-Modus = 200 ms */
const EDGE_MS = 200;
/** ANNAHME A-30: das destruktive Schneiden beginnt mit 4 gleichen Regionen */
const DEFAULT_REGIONS = 4;
/** JJOS2XL: AUTO nur für Samples bis 20 Sekunden */
const AUTO_MAX_SEC = 20;

export const WAVE_AREA = { x: 0, y: 17, w: LCD_W, h: 38 };

/** Positionen mit 7 Stellen; längere Samples in Tausend („12345k“). */
export function fmtPos(v: number): string {
  return v < 1e7 ? String(v).padStart(7, '0') : `${Math.round(v / 1000)}k`.padStart(7);
}

interface HeldPad { physical: number; gate: boolean; retrigger: (() => void) | null }

export class TrimScreen implements Screen {
  readonly id = 'trim';
  sampleId: string | null = null;
  page: Page = 'trim';
  cursor: TrimField = 'sample';
  zoom = 0;
  levelZoom = 1;
  pgmMode = false;
  endKind: 'End' | 'Len' = 'End';
  chopNo = 1;
  reverseChops = false;
  /** Non-Destructive Chop: SLICE-Vorschau (Schnittpunkte) bzw. null */
  ndSlice: number[] | null = null;
  ndSliceCount = 16;
  /** destruktives Schneiden: Schnittpunkte je Sample (Region i = [cuts[i], cuts[i+1])) */
  private regions = new Map<string, number[]>();
  region = 0;
  regionSlice = false;
  private held = new Map<number, HeldPad>();
  private flashRange: { range: [number, number]; until: number } | null = null;

  constructor(private ctx: AppCtx) {}

  // ---------- Daten ----------

  get meta(): SampleMeta | undefined { return this.ctx.store.sample(this.sampleId); }
  get channels(): Float32Array[] { return this.sampleId ? this.ctx.store.sampleAudio(this.sampleId)?.channels ?? [] : []; }
  get nd(): boolean { return this.page === 'trim' && !!this.meta?.chopOn; }

  onEnter(): void {
    const store = this.ctx.store;
    if (!this.meta) {
      const padSample = store.currentProgram.pads[this.ctx.ui.selectedPad]?.layers[0].sampleId ?? null;
      this.setSample(padSample ?? store.samplesSorted()[0]?.id ?? null);
    }
    this.ensureCursor();
  }

  setSample(id: string | null): void {
    if (id === this.sampleId) return;
    this.sampleId = id;
    this.zoom = 0;
    this.chopNo = 1;
    this.region = 0;
    this.ndSlice = null;
    this.regionSlice = false;
  }

  cuts(): number[] {
    const m = this.meta;
    if (!m) return [0, 0];
    let c = this.regions.get(m.id);
    if (!c || c.at(-1)! > m.frames) { c = sliceEqual(m.start, m.end, DEFAULT_REGIONS); this.regions.set(m.id, c); }
    return c;
  }

  setCuts(c: number[]): void {
    if (!this.meta) return;
    this.regions.set(this.meta.id, c);
    this.region = Math.min(this.region, c.length - 2);
  }

  /** Bearbeitungsbereich der St/End-Felder: Chop, Region oder Start–Ende. */
  range(): [number, number] {
    const m = this.meta;
    if (!m) return [0, 0];
    if (this.page === 'chop') { const c = this.cuts(); return [c[this.region]!, c[this.region + 1]!]; }
    if (m.chopOn) { const r = m.chops[this.chopNo - 1]; return r ? [r.start, r.end] : [m.start, m.end]; }
    return [m.start, m.end];
  }

  pointOf(f: TrimField): number {
    const m = this.meta;
    const [s, e] = this.range();
    if (!m) return 0;
    if (f === 'st') return s;
    if (f === 'end') return e;
    if (f === 'lp') return m.loopPoint;
    return Math.round((s + e) / 2);
  }

  /** Frames pro Wheel-Raste: ein Bildpunkt der aktuellen Ansicht (Bedienhilfe D-25). */
  wheelStep(zoom = this.zoom, width = WAVE_AREA.w): number {
    const m = this.meta;
    if (!m) return 1;
    const v = viewAround(0, m.frames, zoom);
    return Math.max(1, Math.round((v.to - v.from) / width));
  }

  /** Punkt verschieben; berücksichtigt Loop-Kopplung, Len-Modus, Nachbar-Regionen. */
  adjust(f: TrimField, delta: number): void {
    const m = this.meta;
    if (!m || delta === 0) return;
    const store = this.ctx.store;
    if (this.page === 'chop') {
      const c = [...this.cuts()];
      const i = f === 'st' ? this.region : this.region + 1;
      const lo = i === 0 ? 0 : c[i - 1]! + 1;
      const hi = i === c.length - 1 ? m.frames : c[i + 1]! - 1;
      c[i] = Math.min(hi, Math.max(lo, c[i]! + delta));
      this.setCuts(c);
      return;
    }
    if (m.chopOn) {
      const chops = m.chops.map((r) => ({ ...r }));
      const r = chops[this.chopNo - 1];
      if (!r) return;
      if (f === 'st') r.start = Math.min(r.end, Math.max(0, r.start + delta));
      else if (f === 'end') r.end = Math.min(m.frames, Math.max(r.start, r.end + delta));
      store.updateSampleMeta(m.id, { chops });
      return;
    }
    let { start, end, loopPoint } = m;
    const len = end - loopPoint;
    if (f === 'st') {
      start = Math.min(end, Math.max(0, start + delta));
      if (m.loopLock) loopPoint = start;
    } else if (f === 'end') {
      if (this.endKind === 'Len' && m.loopOn) end = Math.min(m.frames, Math.max(loopPoint + 1, end + delta)); // Loop-Länge
      else end = Math.min(m.frames, Math.max(start, end + delta));
    } else if (f === 'lp') {
      if (this.endKind === 'Len' && m.loopOn) {
        // JJOS2XL: Loop-Punkt verschieben und dabei die Loop-Länge halten
        loopPoint = Math.min(m.frames - len, Math.max(0, loopPoint + delta));
        end = loopPoint + len;
      } else loopPoint = Math.min(end, Math.max(0, loopPoint + delta));
      if (m.loopLock) start = Math.min(end, loopPoint);
    }
    store.updateSampleMeta(m.id, { start: Math.min(start, end), end, loopPoint: Math.max(Math.min(start, end), loopPoint) });
  }

  /** Punkt direkt setzen (Nulldurchgang). */
  setPoint(f: TrimField, value: number): void {
    this.adjust(f, Math.round(value) - this.pointOf(f));
  }

  // ---------- Felder ----------

  fields(): TrimField[] {
    const m = this.meta;
    if (this.page === 'chop') return ['sample', 'region', 'st', 'end'];
    if (m?.chopOn) return ['sample', 'chop', 'chopNo', 'st', 'end'];
    if (m?.loopOn) return ['sample', 'chop', 'st', 'lp', 'lock', 'endKind', 'end', 'loopMode'];
    return ['sample', 'chop', 'st', 'end'];
  }

  private ensureCursor(): void {
    if (!this.fields().includes(this.cursor)) this.cursor = this.fields().includes('st') ? 'st' : 'sample';
  }

  private upperRow(f: TrimField): boolean { return f === 'sample' || f === 'chop' || f === 'chopNo' || f === 'region'; }

  // ---------- Anzeige ----------

  softkeys(): readonly string[] {
    const m = this.meta;
    if (this.page === 'chop') return ['TRIM', 'AUTO', this.regionSlice ? 'SLICE*' : 'SLICE', 'DIVIDE', 'COMBIN', 'EDIT'];
    if (m?.chopOn) {
      if (this.ndSlice) return ['', '', '', 'AUTO', 'ABBR.', 'DO IT'];
      return ['', 'ZOOM-', 'ZOOM+', this.reverseChops ? 'REV ON' : 'REVERS', 'SLICE', 'NEWPGM'];
    }
    return [this.pgmMode ? 'PGM ON' : 'PGMMOD', 'ZOOM-', 'ZOOM+', m?.loopOn ? 'LP ON' : 'LP OFF', 'CHOP', 'EDIT'];
  }

  animating(): boolean {
    if (this.flashRange && performance.now() > this.flashRange.until) { this.flashRange = null; return true; }
    return !!this.flashRange;
  }

  render(fb: FrameBuffer): void {
    fb.clear();
    const m = this.meta;
    const sel = (f: TrimField) => this.cursor === f;
    const pgmPad = this.pgmMode && this.page === 'trim' ? padName(this.ctx.ui.selectedPad) : 'Smp';
    fb.text(0, 0, `${pgmPad}:`);
    fb.text(4 * CELL_W, 0, (m?.name ?? '(kein Sample)').padEnd(16), sel('sample'));
    if (!m) {
      fb.text(0, 3 * CELL_H, 'Kein Sample im Speicher.');
      fb.text(0, 4 * CELL_H, 'Mit LOAD (MODE + PAD 2) laden.');
      drawSoftkeys(fb, this.softkeys());
      return;
    }
    const zoomTxt = `Z${String(this.zoom).padStart(2, '0')}${this.levelZoom > 1 ? '×' + this.levelZoom : ''}`;
    fb.text(LCD_W - zoomTxt.length * CELL_W, 0, zoomTxt);

    if (this.page === 'chop') {
      const c = this.cuts();
      fb.text(21 * CELL_W, 0, 'Rgn:');
      fb.text(25 * CELL_W, 0, String(this.region + 1).padStart(2, '0'), sel('region'));
      fb.text(27 * CELL_W, 0, `/${String(c.length - 1).padStart(2, '0')}`);
    } else {
      fb.text(21 * CELL_W, 0, 'Chop:');
      fb.text(26 * CELL_W, 0, m.chopOn ? 'ON ' : 'OFF', sel('chop'));
      if (m.chopOn) {
        fb.text(30 * CELL_W, 0, String(this.chopNo).padStart(2, '0'), sel('chopNo'));
        fb.text(32 * CELL_W, 0, `/${m.chops.length}`);
      }
    }

    const [s, e] = this.range();
    fb.text(0, CELL_H, 'St:');
    fb.text(3 * CELL_W, CELL_H, fmtPos(s), sel('st'));
    if (this.page === 'trim' && !m.chopOn && m.loopOn) {
      fb.text(11 * CELL_W, CELL_H, 'Lp:');
      fb.text(14 * CELL_W, CELL_H, fmtPos(m.loopPoint), sel('lp'));
      fb.text(21 * CELL_W, CELL_H, m.loopLock ? LOCK : UNLOCK, sel('lock'));
      fb.text(23 * CELL_W, CELL_H, this.endKind, sel('endKind'));
      fb.text(26 * CELL_W, CELL_H, ':');
      fb.text(27 * CELL_W, CELL_H, fmtPos(this.endKind === 'Len' ? e - m.loopPoint : e), sel('end'));
      fb.text(35 * CELL_W, CELL_H, m.loopMode === 'XFADE' ? 'XFD' : m.loopMode, sel('loopMode'));
    } else {
      fb.text(23 * CELL_W, CELL_H, 'End:');
      fb.text(27 * CELL_W, CELL_H, fmtPos(e), sel('end'));
      if (this.page === 'trim' && m.chopOn && this.reverseChops) fb.text(35 * CELL_W, CELL_H, 'REV');
    }
    if (this.ndSlice) fb.text(35 * CELL_W, CELL_H, `÷${String(this.ndSlice.length - 1).padStart(2, '0')}`);
    if (this.regionSlice) fb.text(35 * CELL_W, CELL_H, `÷${String(this.cuts().length - 1).padStart(2, '0')}`);

    this.renderWave(fb);
    drawSoftkeys(fb, this.softkeys());
  }

  private renderWave(fb: FrameBuffer): void {
    const m = this.meta!;
    const ch = this.channels[0];
    if (!ch) return;
    const [s, e] = this.range();
    const center = this.upperRow(this.cursor) ? Math.round((s + e) / 2) : this.pointOf(this.cursor);
    const view = viewAround(center, m.frames, this.zoom);
    const markers: WaveMarker[] = [];
    if (this.page === 'chop') for (const c of this.cuts()) markers.push({ pos: c, style: 'dash' });
    else if (m.chopOn) for (const r of this.ndSlice ? this.ndSlice.map((p) => ({ start: p, end: p })) : m.chops) markers.push({ pos: r.start, style: 'dash' });
    else if (m.loopOn) markers.push({ pos: m.loopPoint, style: 'dash' });
    markers.push({ pos: s, style: 'solid' }, { pos: Math.max(s, e - 1), style: 'solid' });
    const blink = this.flashRange && Math.floor(performance.now() / 160) % 2 === 0 ? this.flashRange.range : null;
    drawWave(fb, ch, WAVE_AREA, view, { gain: this.levelZoom, sel: [s, e], markers, flash: blink });
  }

  // ---------- Vorhören ----------

  private play(region: PlayRegion, gate: boolean, velocity: number, reverse = false, flash = false): void {
    if (!this.sampleId) return;
    const m = this.meta!;
    const r = { ...region, start: Math.max(0, Math.round(region.start)), end: Math.min(m.frames, Math.round(region.end)) };
    if (r.end <= r.start) return;
    this.ctx.audition(this.sampleId, r, { gate, reverse, velocity });
    if (flash) this.flashRange = { range: [r.start, r.end], until: performance.now() + ((r.end - r.start) / m.sampleRate) * 1000 };
  }

  /** Pads 1–16 wie im JJOS2XL-TRIM (PAD9–PAD12: ANNAHME A-29, PAD13–PAD16: ANNAHME A-28). */
  private trimPad(p: number, velocity: number): HeldPad {
    const m = this.meta!;
    const edge = (EDGE_MS / 1000) * m.sampleRate;
    const plain = this.page === 'trim' && !m.chopOn;
    const loop = plain && m.loopOn ? { point: m.loopPoint, mode: m.loopMode } : undefined;
    const x = this.pointOf(this.upperRow(this.cursor) || this.cursor === 'lock' || this.cursor === 'endKind' || this.cursor === 'loopMode' ? 'st' : this.cursor);
    const go = (): void => {
      const [s2, e2] = this.range();
      switch (p) {
        case 0: case 1: case 2: case 3:
          this.play({ start: s2, end: e2, loop }, true, velocity, plain && p === 2);
          break;
        case 4: case 5: case 6: case 7:
          this.play({ start: s2, end: e2 }, false, velocity, plain && p === 6);
          break;
        case 8: this.play({ start: s2 - edge, end: s2 }, false, velocity, false, true); break;
        case 9: this.play({ start: s2, end: s2 + edge }, false, velocity, false, true); break;
        case 10: this.play({ start: e2 - edge, end: e2 }, false, velocity, false, true); break;
        case 11: this.play({ start: e2, end: e2 + edge }, false, velocity, false, true); break;
        case 12: {
          const lp = loop ? m.loopPoint : s2;
          this.play({ start: lp, end: e2, loop: { point: lp, mode: loop?.mode ?? 'FWD' } }, true, velocity);
          break;
        }
        case 13: this.play({ start: 0, end: x }, false, velocity, false, true); break;
        case 14: this.play({ start: x, end: m.frames }, false, velocity, false, true); break;
        case 15: this.play({ start: 0, end: m.frames }, false, velocity, false, true); break;
      }
    };
    const gate = p <= 3 || p === 12;
    go();
    if (this.cursor !== 'chopNo') {
      if ([0, 1, 4, 5, 8, 9].includes(p)) this.cursor = 'st';
      else if ([2, 3, 6, 7, 10, 11].includes(p)) this.cursor = 'end';
    }
    const retrigger = p <= 3 || (p >= 8 && p <= 11) ? go : null;
    return { physical: p, gate, retrigger };
  }

  /** Pad-Ereignisse; auch von Fenstern (Fine, Edit) weitergereicht. */
  onPad(e: HwEvent & { kind: 'pad' }): boolean {
    const m = this.meta;
    if (!e.down) {
      const h = this.held.get(e.pad);
      this.held.delete(e.pad);
      if (h?.gate) this.ctx.auditionOff();
      return !this.pgmMode || this.page !== 'trim';
    }
    const store = this.ctx.store;
    if (this.pgmMode && this.page === 'trim') {
      const pad = this.ctx.ui.bank * 16 + e.pad;
      // UNDO gehalten + Pad (Cursor im Sample-Feld): aktuelles Sample auf das Pad legen (JJOS2XL Pgm Mode)
      if (this.ctx.ui.held.has('UNDO_SEQ') && this.cursor === 'sample' && this.sampleId) {
        store.updateLayer(store.currentProgram.id, pad, 0, { sampleId: this.sampleId, chop: 0 });
        this.ctx.flash(`${this.meta?.name ?? ''} → ${padName(pad)}`);
        return true;
      }
      const sid = store.currentProgram.pads[pad]?.layers[0].sampleId ?? null;
      if (sid) this.setSample(sid);
      this.ensureCursor();
      return false; // App spielt das Program-Pad wie gewohnt
    }
    if (!m) return true;
    if (m.chopOn && this.page === 'trim' && this.cursor !== 'chopNo' && !this.ndSlice) {
      // Pads A01–B16 = Chop1–Chop32, immer ONE SHOT (JJOS2XL)
      const idx = this.ctx.ui.bank * 16 + e.pad;
      const r = m.chops[idx];
      if (!r) return true;
      this.chopNo = idx + 1;
      const edge = (EDGE_MS / 1000) * m.sampleRate;
      if (this.ctx.ui.held.has('SHIFT')) this.play({ start: r.end - edge, end: r.end }, false, e.velocity, false, true);
      else this.play({ start: r.start, end: r.end }, false, e.velocity, this.reverseChops, true);
      return true;
    }
    this.held.set(e.pad, this.trimPad(e.pad, e.velocity));
    return true;
  }

  // ---------- Bedienung ----------

  onEvent(e: HwEvent): boolean {
    if (e.kind === 'pad') return this.onPad(e);
    if (e.kind === 'wheel') { this.wheel(e.delta); return true; }
    if (e.kind !== 'button') return false;
    if (!e.down) return false;
    const shift = this.ctx.ui.held.has('SHIFT');
    const m = this.meta;
    const fields = this.fields();
    const i = fields.indexOf(this.cursor);
    switch (e.id) {
      case 'STOP': this.ctx.auditionOff(true); this.flashRange = null; return false;
      case 'CURSOR_LEFT':
        if (shift) { this.zoomBy(-1); return true; }
        this.regionSlice = false;
        if (this.page === 'chop' && this.cursor === 'st' && this.region > 0) { this.region--; return true; }
        this.cursor = fields[Math.max(0, i - 1)]!;
        return true;
      case 'CURSOR_RIGHT':
        if (shift) { this.zoomBy(1); return true; }
        this.regionSlice = false;
        if (this.page === 'chop' && this.cursor === 'end' && this.region < this.cuts().length - 2) { this.region++; return true; }
        this.cursor = fields[Math.min(fields.length - 1, i + 1)]!;
        return true;
      case 'CURSOR_UP':
        if (shift) { this.cursor = fields.find((f) => this.upperRow(f)) ?? 'sample'; return true; }
        this.levelZoom = Math.min(16, this.levelZoom * 2);
        return true;
      case 'CURSOR_DOWN':
        if (this.upperRow(this.cursor)) { this.cursor = 'st'; return true; }
        this.levelZoom = Math.max(1, this.levelZoom / 2);
        return true;
      case 'BAR_NEXT': this.zoomBy(1); return true;
      case 'BAR_PREV': this.zoomBy(-1); return true;
      case 'STEP_NEXT': case 'STEP_PREV': return true;
      case 'WINDOW':
        if (!m) return true;
        if (this.cursor === 'sample') this.ctx.openWindow(new SampleWindow(this.ctx, this));
        else if (this.cursor === 'st' || this.cursor === 'end' || this.cursor === 'lp') this.ctx.openWindow(new FineWindow(this.ctx, this, this.cursor));
        return true;
    }
    if (!/^F[1-6]$/.test(e.id)) return false;
    const n = Number(e.id.slice(1));
    if (!m) return true;
    // SHIFT + F1–F6: feste Edit-Funktionen (ANNAHME A-27), im Chop-Modus auf den gewählten Chop
    if (shift && this.page === 'trim' && !this.ndSlice) {
      this.ctx.openWindow(new SampleEditWindow(this.ctx, this, SHIFT_EDITS[n - 1]!));
      return true;
    }
    if (this.page === 'chop') this.chopPageKey(n);
    else if (m.chopOn) this.ndKey(n);
    else this.trimKey(n);
    this.ensureCursor();
    return true;
  }

  private zoomBy(d: number): void {
    const m = this.meta;
    if (!m) return;
    this.zoom = step(this.zoom, d, 0, maxZoom(m.frames, WAVE_AREA.w));
  }

  private trimKey(n: number): void {
    const m = this.meta!;
    switch (n) {
      case 1: this.pgmMode = !this.pgmMode; this.ctx.flash(this.pgmMode ? 'Pgm Mode: Pads spielen das Program' : 'Pgm Mode aus'); break;
      case 2: this.zoomBy(-1); break;
      case 3: this.zoomBy(1); break;
      case 4: this.ctx.store.updateSampleMeta(m.id, { loopOn: !m.loopOn }); break;
      case 5: this.page = 'chop'; this.pgmMode = false; this.cursor = 'region'; this.cuts(); break;
      case 6: this.ctx.openWindow(new SampleEditWindow(this.ctx, this)); break;
    }
  }

  /** ANNAHME A-26: Tastenbelegung im Non-Destructive-Chop-Modus */
  private ndKey(n: number): void {
    const m = this.meta!;
    if (this.ndSlice) {
      if (n === 4) {
        if (m.frames / m.sampleRate > AUTO_MAX_SEC) { this.ctx.flash('AUTO nur bis 20 Sekunden'); return; }
        this.ctx.openWindow(new AutoSliceWindow(this.ctx, this, MAX_CHOPS, [m.start, m.end], (cuts) => { this.ndSlice = cuts; }));
      } else if (n === 5) this.ndSlice = null;
      else if (n === 6) {
        const c = this.ndSlice;
        const chops = c.slice(0, -1).map((s, i) => ({ start: s, end: c[i + 1]! }));
        this.ctx.store.updateSampleMeta(m.id, { chops });
        this.chopNo = 1;
        this.ndSlice = null;
        this.ctx.flash(`${chops.length} Chops gesetzt`);
      }
      return;
    }
    switch (n) {
      case 2: this.zoomBy(-1); break;
      case 3: this.zoomBy(1); break;
      case 4: this.reverseChops = !this.reverseChops; break;
      case 5: this.ndSlice = sliceEqual(m.start, m.end, this.ndSliceCount); break;
      case 6: this.ctx.openWindow(new NewChopProgramWindow(this.ctx, this)); break;
    }
  }

  private chopPageKey(n: number): void {
    const m = this.meta!;
    const c = this.cuts();
    switch (n) {
      case 1: this.page = 'trim'; this.regionSlice = false; this.cursor = 'st'; break;
      case 2:
        if (m.frames / m.sampleRate > AUTO_MAX_SEC) { this.ctx.flash('AUTO nur bis 20 Sekunden'); return; }
        this.ctx.openWindow(new AutoSliceWindow(this.ctx, this, MAX_REGIONS, [c[0]!, c.at(-1)!], (cuts) => { this.setCuts(cuts); this.region = 0; }));
        break;
      case 3: this.regionSlice = !this.regionSlice; break;
      case 4: { // DIVIDE: gewählte Region halbieren
        if (c.length - 1 >= MAX_REGIONS) { this.ctx.flash('Höchstens 64 Regionen'); return; }
        const a = c[this.region]!;
        const b = c[this.region + 1]!;
        if (b - a < 2) return;
        this.setCuts([...c.slice(0, this.region + 1), Math.round((a + b) / 2), ...c.slice(this.region + 1)]);
        break;
      }
      case 5: { // COMBINE: mit linker (Cursor St) bzw. rechter (Cursor End) Nachbarregion
        if (c.length <= 2) return;
        const left = this.cursor !== 'end';
        const idx = left ? this.region : this.region + 1;
        if (idx <= 0 || idx >= c.length - 1) return;
        this.setCuts([...c.slice(0, idx), ...c.slice(idx + 1)]);
        if (left) this.region = Math.max(0, this.region - 1);
        break;
      }
      case 6: this.ctx.openWindow(new ExtractWindow(this.ctx, this, c)); break;
    }
  }

  private wheel(raw: number): void {
    const store = this.ctx.store;
    const m = this.meta;
    const coarse = this.ctx.coarse() ? 10 : 1;
    if (this.ndSlice && m) {
      this.ndSliceCount = step(this.ndSliceCount, raw * coarse, 2, MAX_CHOPS);
      this.ndSlice = sliceEqual(m.start, m.end, this.ndSliceCount);
      return;
    }
    if (this.regionSlice && m) {
      const c = this.cuts();
      const count = step(c.length - 1, raw * coarse, 2, MAX_REGIONS);
      this.setCuts(sliceEqual(c[0]!, c.at(-1)!, count));
      return;
    }
    switch (this.cursor) {
      case 'sample': {
        const list = store.samplesSorted().map((s) => s.id);
        if (!list.length) return;
        const idx = Math.max(0, list.indexOf(this.sampleId ?? ''));
        this.setSample(list[Math.min(list.length - 1, Math.max(0, idx + raw))]!);
        if (this.pgmMode && this.sampleId) store.updateLayer(store.currentProgram.id, this.ctx.ui.selectedPad, 0, { sampleId: this.sampleId, chop: 0 });
        this.ensureCursor();
        break;
      }
      case 'chop': {
        if (!m) return;
        const on = raw > 0;
        if (on === m.chopOn) return;
        // JJOS2XL: beim Einschalten 32 gleiche Chops (falls noch keine gesetzt)
        store.updateSampleMeta(m.id, { chopOn: on, chops: on && !m.chops.length ? equalChops(m.start, m.end) : m.chops });
        this.chopNo = 1;
        this.pgmMode = false;
        break;
      }
      case 'chopNo': if (m) this.chopNo = step(this.chopNo, raw, 1, Math.max(1, m.chops.length)); break;
      case 'region': this.region = step(this.region, raw, 0, this.cuts().length - 2); break;
      case 'lock':
        if (m) store.updateSampleMeta(m.id, { loopLock: raw > 0, ...(raw > 0 ? { loopPoint: m.start } : {}) });
        break;
      case 'endKind': this.endKind = raw > 0 ? 'Len' : 'End'; break;
      case 'loopMode': if (m) store.updateSampleMeta(m.id, { loopMode: stepEnum(LOOP_MODES, m.loopMode, raw) }); break;
      case 'st': case 'end': case 'lp':
        this.adjust(this.cursor, raw * coarse * this.wheelStep());
        break;
    }
    // gehaltene Pads hören die Änderung sofort (JJOS2XL)
    for (const h of this.held.values()) h.retrigger?.();
  }
}
