/**
 * Fenster des TRIM-Modus: Fine/Joint, Sample-Edit mit Keep/Retry, Namenseingabe, Auto Slice,
 * Extract (Regionen → Samples), Chops → neues Program, Sample-Fenster (Liste, Löschen, Kopieren).
 */
import { MAX_CHOPS, padName, sanitizeName, SAMPLE_NAME_MAX, uniqueName } from '../../core/model';
import { defaultEditParams, EDIT_KINDS, editResult, runEdit, type EditKind, type EditOutput, type EditParams } from '../../dsp/editRunner';
import { autoSlice, extract, zeroCrossing } from '../../dsp/sampleEdit';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import type { FrameBuffer } from '../display/framebuffer';
import { drawWave, frameToX, viewAround } from '../display/waveform';
import { drawSoftkeys, drawWindowFrame, step, stepEnum, type AppCtx } from './screen';
import { fmtPos, type TrimField, type TrimScreen } from './trimScreen';
import { Window } from './windows';

/** ANNAHME A-27: SHIFT + F1–F6 im TRIM-Modus (JJOS2XL: „only 6 fixed functions“) */
export const SHIFT_EDITS: readonly EditKind[] = ['DELETE', 'SILENCE', 'NORMALIZE', 'REVERSE', 'FADE IN', 'FADE OUT'];

/** Name für ein neues Sample: Basis + Endung, max. 16 Zeichen, eindeutig. */
function suggestName(ctx: AppCtx, base: string, suffix: string): string {
  const b = base.slice(0, SAMPLE_NAME_MAX - suffix.length) + suffix;
  return uniqueName(b, ctx.store.state.samples.map((s) => s.name));
}

// ---------------------------------------------------------------------------
// Namenseingabe: Wheel wählt das Zeichen, Cursor die Stelle (MPC1000-Handbuch „Setting names“)
// ---------------------------------------------------------------------------
const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!#&()+.,';

export class NameWindow extends Window {
  readonly id = 'name';
  private chars: string[];
  private pos = 0;
  private typed = false;
  constructor(ctx: AppCtx, private title: string, initial: string, private onDone: (name: string) => void) {
    super(ctx);
    this.chars = initial.padEnd(SAMPLE_NAME_MAX).slice(0, SAMPLE_NAME_MAX).split('');
  }
  softkeys() { return ['', 'ENTF', 'EINF', 'ABBR.', 'ENTER', '']; }
  wantsText(): boolean { return true; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, this.title);
    fb.text(x, y + CELL_H, 'Name:');
    this.chars.forEach((c, i) => fb.text(x + (6 + i) * CELL_W, y + CELL_H, c, i === this.pos));
    fb.text(x, y + 3 * CELL_H, 'Tippen oder Wheel; ◀ ▶ = Stelle');
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'text') {
      // Computertastatur: Zeichen an der Cursorstelle, Löschen, Enter (D-31 aufgehoben)
      if (e.text === '\n') { this.finish(); return true; }
      if (e.text === '\b') {
        if (this.pos > 0) { this.pos--; this.chars.splice(this.pos, 1); this.chars.push(' '); }
        return true;
      }
      // erstes getipptes Zeichen ersetzt den ganzen Vorschlag (wie markierter Text)
      if (!this.typed) { this.chars = Array.from({ length: SAMPLE_NAME_MAX }, () => ' '); this.pos = 0; this.typed = true; }
      this.chars[this.pos] = e.text;
      this.pos = Math.min(SAMPLE_NAME_MAX - 1, this.pos + 1);
      return true;
    }
    if (e.kind === 'wheel') {
      const cur = NAME_CHARS.indexOf(this.chars[this.pos]!);
      const n = NAME_CHARS.length;
      this.chars[this.pos] = NAME_CHARS[(((cur < 0 ? 0 : cur) + e.delta) % n + n) % n]!;
      return true;
    }
    if (e.kind !== 'button' || !e.down) return e.kind === 'pad';
    switch (e.id) {
      case 'CURSOR_LEFT': this.pos = Math.max(0, this.pos - 1); return true;
      case 'CURSOR_RIGHT': this.pos = Math.min(SAMPLE_NAME_MAX - 1, this.pos + 1); return true;
      case 'F2': this.chars.splice(this.pos, 1); this.chars.push(' '); return true;
      case 'F3': this.chars.splice(this.pos, 0, ' '); this.chars.length = SAMPLE_NAME_MAX; return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': this.finish(); return true;
    }
    return false;
  }

  private finish(): void {
    const name = sanitizeName(this.chars.join('').trimEnd());
    this.ctx.closeWindow();
    this.onDone(name);
  }
}

// ---------------------------------------------------------------------------
// Ja/Nein-Abfrage
// ---------------------------------------------------------------------------
export class ConfirmWindow extends Window {
  readonly id = 'confirm';
  constructor(ctx: AppCtx, private title: string, private text: string, private onYes: () => void) { super(ctx); }
  softkeys() { return ['', '', '', 'NEIN', 'JA', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, this.title);
    fb.text(x, y + CELL_H, this.text.slice(0, 36));
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind !== 'button' || !e.down) return true;
    if (e.id === 'F4') { this.ctx.closeWindow(); return true; }
    if (e.id === 'F5') { this.ctx.closeWindow(); this.onYes(); return true; }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fine-Fenster (MPC1000) bzw. Joint (JJOS2XL, bei Loop ON): Punkt im Detail, Nulldurchgang
// ---------------------------------------------------------------------------
export class FineWindow extends Window {
  readonly id = 'fine';
  private zoom: number;
  private gain = 1;
  constructor(ctx: AppCtx, private trim: TrimScreen, private field: TrimField) {
    super(ctx);
    this.zoom = Math.max(trim.zoom + 4, 8);
  }
  private get joint(): boolean { return !!this.trim.meta?.loopOn && !this.trim.meta.chopOn && this.trim.page === 'trim' && this.field !== 'st'; }
  softkeys() { return ['', '◀ZCROS', 'ZCROS▶', 'CLOSE', 'ZOOM-', 'ZOOM+']; }
  animating(): boolean { return false; }
  render(fb: FrameBuffer): void {
    const m = this.trim.meta;
    const ch = this.trim.channels[0];
    fb.fillRect(0, 0, 240, 56, false);
    if (!m || !ch) { this.ctx.closeWindow(); return; }
    const area = { x: 0, y: 10, w: 240, h: 45 };
    const label = this.joint ? 'Joint' : 'Fine';
    const names: Partial<Record<TrimField, string>> = { st: 'St', end: 'End', lp: 'Lp' };
    fb.text(0, 0, `${label}  ${m.name}`.slice(0, 24));
    fb.text(25 * CELL_W, 0, `${names[this.field]}:`);
    fb.text(29 * CELL_W, 0, fmtPos(this.trim.pointOf(this.field)), true);
    if (this.joint) {
      // links das Loop-Ende, rechts der Loop-Punkt – so lässt sich die Nahtstelle angleichen
      const half = { ...area, w: 120 };
      const v = viewAround(0, m.frames, this.zoom);
      const vis = v.to - v.from;
      const end = this.trim.pointOf('end');
      const lp = m.loopPoint;
      drawWave(fb, ch, half, { from: end - vis / 2, to: end }, { gain: this.gain });
      drawWave(fb, ch, { ...half, x: 120 }, { from: lp, to: lp + vis / 2 }, { gain: this.gain });
      fb.vline(120, area.y, area.h);
      fb.text(0, area.y, 'End');
      fb.text(240 - 2 * CELL_W, area.y, 'Lp');
    } else {
      const p = this.trim.pointOf(this.field);
      const view = viewAround(p, m.frames, this.zoom);
      drawWave(fb, ch, area, view, { gain: this.gain, sel: this.trim.range(), markers: [{ pos: p, style: 'solid' }] });
      const mx = frameToX(p, area, view);
      fb.vline(mx, area.y, area.h);
    }
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const m = this.trim.meta;
    if (!m) return false;
    if (e.kind === 'pad') return this.trim.onPad(e);
    if (e.kind === 'wheel') {
      const v = viewAround(0, m.frames, this.zoom);
      const stepFrames = Math.max(1, Math.round((v.to - v.from) / 240));
      this.trim.adjust(this.field, e.delta * stepFrames * (this.ctx.coarse() ? 10 : 1));
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    const ch = this.trim.channels[0];
    switch (e.id) {
      case 'F2': case 'F3':
        if (ch) this.trim.setPoint(this.field, zeroCrossing(ch, this.trim.pointOf(this.field), e.id === 'F2' ? -1 : 1));
        return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': this.zoom = Math.max(0, this.zoom - 1); return true;
      case 'F6': this.zoom = Math.min(24, this.zoom + 1); return true;
      case 'CURSOR_UP': this.gain = Math.min(16, this.gain * 2); return true;
      case 'CURSOR_DOWN': this.gain = Math.max(1, this.gain / 2); return true;
      case 'CURSOR_LEFT': case 'CURSOR_RIGHT':
        if (this.joint) this.field = this.field === 'end' ? 'lp' : 'end';
        return true;
      case 'STOP': this.ctx.auditionOff(true); return false;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sample-Edit (F6 EDIT bzw. SHIFT + F1–F6)
// ---------------------------------------------------------------------------
type EditRow = 'kind' | 'time' | 'bits' | 'freq' | 'wave' | 'mix' | 'other' | 'levelA' | 'levelB' | 'name';

export class SampleEditWindow extends Window {
  readonly id = 'sample-edit';
  private kind: EditKind;
  private row: EditRow = 'kind';
  private params: EditParams = defaultEditParams();
  private otherId: string | null = null;
  private newName: string;
  constructor(ctx: AppCtx, private trim: TrimScreen, kind?: EditKind) {
    super(ctx);
    this.kind = kind ?? 'DISCARD';
    this.newName = suggestName(ctx, trim.meta?.name ?? 'Sample', '-1');
    this.otherId = ctx.store.samplesSorted().find((s) => s.id !== trim.sampleId)?.id ?? null;
  }

  private rows(): EditRow[] {
    switch (this.kind) {
      case 'INSERT SILENCE': return ['kind', 'time'];
      case 'BIT CONVERT': return ['kind', 'bits'];
      case 'RING MOD': return ['kind', 'freq', 'wave', 'mix'];
      case 'COMBINE': return ['kind', 'other'];
      case 'MIX': return ['kind', 'other', 'levelA', 'levelB'];
      case 'EXTRACT': case 'COPY': return ['kind', 'name'];
      default: return ['kind'];
    }
  }

  softkeys() { return [this.rows().includes('name') ? 'NAME' : '', '', '', 'ABBR.', 'DO IT', '']; }

  private describe(): string {
    const nd = this.trim.nd;
    switch (this.kind) {
      case 'DISCARD': return 'Alles außerhalb St–End löschen';
      case 'DELETE': return 'Bereich St–End herausschneiden';
      case 'SILENCE': return 'Bereich St–End stumm schalten';
      case 'EXTRACT': return 'Bereich als neues Sample';
      case 'NORMALIZE': return nd ? 'Chop auf vollen Pegel' : 'Ganzes Sample auf vollen Pegel';
      case 'REVERSE': return nd ? 'Chop rückwärts' : 'Ganzes Sample rückwärts';
      case 'INSERT SILENCE': return 'Stille am Startpunkt einfügen';
      case 'FADE IN': return 'Einblenden über St–End';
      case 'FADE OUT': return 'Ausblenden über St–End';
      case 'STEREO>MONO': return 'Stereo zu Mono (L+R)';
      case 'BIT CONVERT': return 'Auf 4–12 Bit reduzieren';
      case 'RING MOD': return 'Ringmodulation über St–End';
      case 'COMBINE': return 'Sample B anhängen';
      case 'MIX': return 'Sample B dazumischen';
      case 'COPY': return 'Sample kopieren';
    }
  }

  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Sample bearbeiten');
    const [s, e] = this.trim.range();
    const sel = (r: EditRow) => this.row === r;
    fb.text(x, y, 'Edit:');
    fb.text(x + 6 * CELL_W, y, this.kind.padEnd(14), sel('kind'));
    fb.text(x + 21 * CELL_W, y, `${e - s}`.padStart(9).slice(-9) + ' Pkt');
    let line = 1;
    const field = (label: string, value: string, r: EditRow) => {
      fb.text(x + (line > 2 ? 18 : 0) * CELL_W, y + ((line - 1) % 2 + 1) * CELL_H, label);
      fb.text(x + ((line > 2 ? 18 : 0) + label.length) * CELL_W, y + ((line - 1) % 2 + 1) * CELL_H, value, sel(r));
      line++;
    };
    const p = this.params;
    for (const r of this.rows().slice(1)) {
      switch (r) {
        case 'time': field('Zeit:', `${p.silenceMs} ms`.padStart(9), r); break;
        case 'bits': field('Bit:', String(p.bits).padStart(3), r); break;
        case 'freq': field('Freq:', `${p.ringFreq} Hz`.padStart(8), r); break;
        case 'wave': field('Welle:', p.ringWave === 'SINE' ? 'Sinus  ' : 'Rechteck', r); break;
        case 'mix': field('Mix:', String(p.ringMix).padStart(3), r); break;
        case 'other': field('Sample B:', (this.ctx.store.sample(this.otherId)?.name ?? '(kein)').padEnd(16), r); break;
        case 'levelA': field('Pegel A:', `${p.levelA}%`.padStart(4), r); break;
        case 'levelB': field('Pegel B:', `${p.levelB}%`.padStart(4), r); break;
        case 'name': field('Neuer Name:', this.newName.padEnd(16), r); break;
      }
    }
    if (line <= 2) fb.text(x, y + 2 * CELL_H, this.describe());
    else if (line <= 3) fb.text(x, y + 3 * CELL_H, this.describe());
    drawSoftkeys(fb, this.softkeys());
  }

  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad') return this.trim.onPad(e);
    const rows = this.rows();
    const p = this.params;
    const c = this.ctx.coarse() ? 10 : 1;
    if (e.kind === 'wheel') {
      const d = e.delta;
      switch (this.row) {
        case 'kind': this.kind = stepEnum(EDIT_KINDS, this.kind, d); break;
        case 'time': p.silenceMs = step(p.silenceMs, d * 10 * c, 10, 10000); break;
        case 'bits': p.bits = step(p.bits, d, 4, 12); break;
        case 'freq': p.ringFreq = step(p.ringFreq, d * 10 * c, 100, 5000); break;
        case 'wave': p.ringWave = d > 0 ? 'SQUARE' : 'SINE'; break;
        case 'mix': p.ringMix = step(p.ringMix, d, 1, 10); break;
        case 'levelA': p.levelA = step(p.levelA, d * c, 0, 100); break;
        case 'levelB': p.levelB = step(p.levelB, d * c, 0, 100); break;
        case 'other': {
          const list = this.ctx.store.samplesSorted().map((s) => s.id);
          const i = Math.max(0, list.indexOf(this.otherId ?? ''));
          this.otherId = list[step(i, d, 0, list.length - 1)] ?? null;
          break;
        }
        case 'name': break;
      }
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    const i = rows.indexOf(this.row);
    switch (e.id) {
      case 'CURSOR_DOWN': case 'CURSOR_RIGHT': this.row = rows[Math.min(rows.length - 1, i + 1)]!; return true;
      case 'CURSOR_UP': case 'CURSOR_LEFT': this.row = rows[Math.max(0, i - 1)]!; return true;
      case 'F1':
        if (rows.includes('name')) this.ctx.openWindow(new NameWindow(this.ctx, 'Neuer Name', this.newName, (n) => { this.newName = n; }));
        return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': this.doIt(); return true;
      case 'STOP': this.ctx.auditionOff(true); return false;
    }
    if (!rows.includes(this.row)) this.row = 'kind';
    return false;
  }

  private doIt(): void {
    const t = this.trim;
    const m = t.meta;
    const audio = t.sampleId ? this.ctx.store.sampleAudio(t.sampleId) : undefined;
    if (!m || !audio) return;
    const store = this.ctx.store;
    if ((this.kind === 'COMBINE' || this.kind === 'MIX')) {
      const other = this.otherId ? store.sampleAudio(this.otherId) : undefined;
      if (!other) { this.ctx.flash('Sample B fehlt'); return; }
      this.params.other = other;
    }
    if (this.kind === 'STEREO>MONO' && m.channels === 1) { this.ctx.flash('Sample ist schon mono'); return; }
    const [s, e] = t.range();
    if (e <= s && !['NORMALIZE', 'REVERSE', 'STEREO>MONO', 'COMBINE', 'MIX', 'COPY', 'INSERT SILENCE'].includes(this.kind)) {
      this.ctx.flash('Bereich ist leer');
      return;
    }
    const { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops } = m;
    const out = runEdit(this.kind, {
      channels: audio.channels, sampleRate: audio.sampleRate,
      play: { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops },
      range: [s, e], rangeIsChop: t.nd,
    }, this.params);
    const mode = editResult(this.kind);
    if (mode === 'inplace') {
      store.replaceSampleAudio(m.id, out.channels, out.play);
      this.ctx.closeWindow();
      this.ctx.flash(`${this.kind} ausgeführt`);
    } else if (mode === 'newSample') {
      const n = store.addSample(this.newName, { channels: out.channels, sampleRate: audio.sampleRate }, m.rootNote, out.play);
      this.ctx.closeWindow();
      this.ctx.flash(`Neues Sample ${n.name}`);
    } else {
      this.ctx.openWindow(new KeepRetryWindow(this.ctx, this.trim, out, audio.sampleRate, suggestName(this.ctx, m.name, '-1')));
    }
  }
}

// ---------------------------------------------------------------------------
// Keep or Retry (MPC1000-Handbuch S. 55): PLAY, OVER W, RETRY, KEEP
// ---------------------------------------------------------------------------
export class KeepRetryWindow extends Window {
  readonly id = 'keep-retry';
  constructor(ctx: AppCtx, private trim: TrimScreen, private out: EditOutput, private sampleRate: number, private name: string) { super(ctx); }
  softkeys() { return ['NAME', 'PLAY', 'OVER W', 'RETRY', 'KEEP', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Behalten oder wiederholen');
    fb.text(x, y, 'Neuer Name:');
    fb.text(x + 12 * CELL_W, y, this.name.padEnd(16), true);
    const frames = this.out.channels[0]?.length ?? 0;
    fb.text(x, y + CELL_H, `Länge: ${(frames / this.sampleRate).toFixed(3)} s`);
    fb.text(x, y + 2 * CELL_H, 'OVER W ersetzt das Original');
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad') {
      if (e.down) this.ctx.previewAudio(this.out.channels, this.sampleRate);
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    const store = this.ctx.store;
    const m = this.trim.meta;
    switch (e.id) {
      case 'F1': this.ctx.openWindow(new NameWindow(this.ctx, 'Neuer Name', this.name, (n) => { this.name = n; })); return true;
      case 'F2': this.ctx.previewAudio(this.out.channels, this.sampleRate); return true;
      case 'F3':
        if (m) store.replaceSampleAudio(m.id, this.out.channels, this.out.play);
        this.ctx.closeWindow(); this.ctx.closeWindow();
        this.ctx.flash('Original überschrieben');
        return true;
      case 'F4': this.ctx.auditionOff(true); this.ctx.closeWindow(); return true;
      case 'F5': {
        const n = store.addSample(this.name, { channels: this.out.channels, sampleRate: this.sampleRate }, m?.rootNote ?? 60, this.out.play);
        this.trim.setSample(n.id);
        this.ctx.closeWindow(); this.ctx.closeWindow();
        this.ctx.flash(`Behalten: ${n.name}`);
        return true;
      }
      case 'STOP': this.ctx.auditionOff(true); return false;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auto Slice (JJOS2XL): Recovery time 10–100, Threshold 0–100
// ---------------------------------------------------------------------------
export class AutoSliceWindow extends Window {
  readonly id = 'auto-slice';
  // ANNAHME A-22: Startwerte Recovery 30, Threshold 50
  private static recovery = 30;
  private static threshold = 50;
  private row = 0;
  constructor(ctx: AppCtx, private trim: TrimScreen, private max: number, private range: [number, number], private onDo: (cuts: number[]) => void) { super(ctx); }
  softkeys() { return ['', '', '', 'ABBR.', 'DO IT', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Auto Slice');
    fb.text(x, y + CELL_H, 'Recovery time:');
    fb.text(x + 15 * CELL_W, y + CELL_H, String(AutoSliceWindow.recovery).padStart(3), this.row === 0);
    fb.text(x, y + 2 * CELL_H, 'Threshold:');
    fb.text(x + 15 * CELL_W, y + 2 * CELL_H, String(AutoSliceWindow.threshold).padStart(3), this.row === 1);
    fb.text(x, y + 3 * CELL_H, `höchstens ${this.max} Teile`);
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad') return this.trim.onPad(e);
    if (e.kind === 'wheel') {
      const c = this.ctx.coarse() ? 10 : 1;
      if (this.row === 0) AutoSliceWindow.recovery = step(AutoSliceWindow.recovery, e.delta * c, 10, 100);
      else AutoSliceWindow.threshold = step(AutoSliceWindow.threshold, e.delta * c, 0, 100);
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = 0; return true;
      case 'CURSOR_DOWN': this.row = 1; return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': {
        const m = this.trim.meta;
        const ch = this.trim.channels[0];
        if (!m || !ch) return true;
        const cuts = autoSlice(ch, m.sampleRate, this.range[0], this.range[1], { recovery: AutoSliceWindow.recovery, threshold: AutoSliceWindow.threshold, max: this.max });
        this.ctx.closeWindow();
        if (cuts.length < 3) { this.ctx.flash('Keine Anschläge gefunden'); return true; }
        this.onDo(cuts);
        this.ctx.flash(`${cuts.length - 1} Teile erkannt`);
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Extract (F6 EDIT im CHOP-Modus): Regionen als neue Samples, wahlweise neues Program
// ---------------------------------------------------------------------------
export class ExtractWindow extends Window {
  readonly id = 'extract';
  private row = 0;
  private all = true;
  private newPgm = true;
  private base: string;
  constructor(ctx: AppCtx, private trim: TrimScreen, private cuts: number[]) {
    super(ctx);
    this.base = (trim.meta?.name ?? 'Sample').slice(0, SAMPLE_NAME_MAX - 3);
  }
  softkeys() { return ['NAME', '', '', 'ABBR.', 'DO IT', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Regionen extrahieren');
    const rows: [string, string][] = [
      ['Region:', this.all ? `ALLE (${this.cuts.length - 1})` : `NUR ${String(this.trim.region + 1).padStart(2, '0')}`],
      ['Name:', `${this.base}-01…`],
      ['Neues Program:', this.newPgm ? 'JA  ' : 'NEIN'],
    ];
    rows.forEach(([l, v], i) => {
      fb.text(x, y + i * CELL_H, l);
      fb.text(x + 15 * CELL_W, y + i * CELL_H, v.padEnd(14), this.row === i);
    });
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad') return this.trim.onPad(e);
    if (e.kind === 'wheel') {
      if (this.row === 0) this.all = e.delta < 0;
      else if (this.row === 2) this.newPgm = e.delta > 0;
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(2, this.row + 1); return true;
      case 'F1': this.ctx.openWindow(new NameWindow(this.ctx, 'Basisname', this.base, (n) => { this.base = n.slice(0, SAMPLE_NAME_MAX - 3); })); return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': this.doIt(); return true;
    }
    return false;
  }
  private doIt(): void {
    const t = this.trim;
    const m = t.meta;
    const audio = t.sampleId ? this.ctx.store.sampleAudio(t.sampleId) : undefined;
    if (!m || !audio) return;
    const store = this.ctx.store;
    const idx = this.all ? this.cuts.slice(0, -1).map((_, i) => i) : [t.region];
    const ids = idx.map((i) => {
      const ch = extract(audio.channels, this.cuts[i]!, this.cuts[i + 1]!);
      return store.addSample(suggestName(this.ctx, this.base, `-${String(i + 1).padStart(2, '0')}`), { channels: ch, sampleRate: audio.sampleRate }, m.rootNote).id;
    });
    let msg = `${ids.length} Sample(s) erzeugt`;
    if (this.newPgm) {
      const p = store.newProgram(uniqueName(this.base.slice(0, 16), store.state.programs.map((x) => x.name)));
      if (p) {
        ids.slice(0, 64).forEach((id, i) => store.updateLayer(p.id, i, 0, { sampleId: id }));
        store.setCurrentProgram(p.id);
        msg += `, Program ${p.name}`;
      }
    }
    this.ctx.closeWindow();
    this.ctx.flash(msg);
  }
}

// ---------------------------------------------------------------------------
// NEW PGM (Non-Destructive Chop): Chop1–32 auf A01–B16 eines neuen Programs
// ---------------------------------------------------------------------------
export class NewChopProgramWindow extends Window {
  readonly id = 'new-chop-pgm';
  private name: string;
  constructor(ctx: AppCtx, private trim: TrimScreen) {
    super(ctx);
    this.name = uniqueName((trim.meta?.name ?? 'Chop').slice(0, 16), ctx.store.state.programs.map((p) => p.name));
  }
  softkeys() { return ['NAME', '', '', 'ABBR.', 'DO IT', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Neues Program aus Chops');
    fb.text(x, y + CELL_H, 'Program:');
    fb.text(x + 9 * CELL_W, y + CELL_H, this.name.padEnd(16), true);
    const n = Math.min(MAX_CHOPS, this.trim.meta?.chops.length ?? 0);
    fb.text(x, y + 2 * CELL_H, `Chop1–${n} → Pads A01–${padName(Math.max(0, n - 1))}`);
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'pad') return true;
    if (e.kind !== 'button' || !e.down) return e.kind === 'wheel';
    switch (e.id) {
      case 'F1': this.ctx.openWindow(new NameWindow(this.ctx, 'Program-Name', this.name, (n) => { this.name = n; })); return true;
      case 'F4': this.ctx.closeWindow(); return true;
      case 'F5': {
        const m = this.trim.meta;
        const store = this.ctx.store;
        if (!m) return true;
        const p = store.newProgram(uniqueName(this.name, store.state.programs.map((x) => x.name)));
        if (!p) { this.ctx.flash('Keine Programs mehr frei'); return true; }
        m.chops.slice(0, MAX_CHOPS).forEach((_, i) => store.updateLayer(p.id, i, 0, { sampleId: m.id, chop: i + 1 }));
        store.setCurrentProgram(p.id);
        this.ctx.closeWindow();
        this.ctx.flash(`Program ${p.name} erstellt`);
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sample-Fenster (WINDOW im Sample-Feld): Liste, Löschen, Umbenennen, Kopieren
// ---------------------------------------------------------------------------
export class SampleWindow extends Window {
  readonly id = 'sample-window';
  private index: number;
  constructor(ctx: AppCtx, private trim: TrimScreen) {
    super(ctx);
    this.index = Math.max(0, ctx.store.samplesSorted().findIndex((s) => s.id === trim.sampleId));
  }
  private get items() { return this.ctx.store.samplesSorted(); }
  softkeys() { return ['', 'LÖSCH.', 'NAME', 'WÄHLEN', 'KOPIE', 'ABBR.']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Sample');
    const items = this.items;
    const rows = 4;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    const first = Math.min(Math.max(0, this.index - 1), Math.max(0, items.length - rows));
    for (let r = 0; r < rows && first + r < items.length; r++) {
      const s = items[first + r]!;
      const info = `${s.channels === 2 ? 'ST' : 'MO'} ${(s.frames / s.sampleRate).toFixed(2)}s`;
      fb.text(x, y + r * CELL_H, `${s.name.padEnd(16)} ${info}`.padEnd(36), first + r === this.index);
    }
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const items = this.items;
    const cur = items[this.index];
    if (e.kind === 'pad') {
      if (e.down && cur) this.ctx.audition(cur.id, { start: cur.start, end: cur.end }, { gate: false, reverse: false, velocity: e.velocity });
      return true;
    }
    if (e.kind === 'wheel') { this.index = step(this.index, e.delta * (this.ctx.coarse() ? 10 : 1), 0, Math.max(0, items.length - 1)); return true; }
    if (e.kind !== 'button' || !e.down) return false;
    const store = this.ctx.store;
    switch (e.id) {
      case 'CURSOR_UP': this.index = Math.max(0, this.index - 1); return true;
      case 'CURSOR_DOWN': this.index = Math.min(items.length - 1, this.index + 1); return true;
      case 'F2':
        if (cur) this.ctx.openWindow(new ConfirmWindow(this.ctx, 'Sample löschen', `${cur.name} löschen?`, () => {
          store.removeSample(cur.id);
          if (this.trim.sampleId === cur.id) this.trim.setSample(store.samplesSorted()[0]?.id ?? null);
          this.ctx.flash(`${cur.name} gelöscht`);
        }));
        return true;
      case 'F3':
        if (cur) this.ctx.openWindow(new NameWindow(this.ctx, 'Sample umbenennen', cur.name, (n) => store.renameSample(cur.id, n)));
        return true;
      case 'F4':
        if (cur) this.trim.setSample(cur.id);
        this.ctx.closeWindow();
        return true;
      case 'F5':
        if (cur) this.ctx.openWindow(new NameWindow(this.ctx, 'Kopie anlegen', suggestName(this.ctx, cur.name, '-C'), (n) => {
          const c = store.copySample(cur.id, n);
          if (c) this.ctx.flash(`Kopie ${c.name}`);
        }));
        return true;
      case 'F6': this.ctx.closeWindow(); return true;
    }
    return false;
  }
}
