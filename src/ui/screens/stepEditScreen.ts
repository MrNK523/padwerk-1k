/**
 * STEP EDIT (MODE + PAD 14) nach MPC1000-Handbuch Kap. 5: Event-Liste des aktiven Tracks,
 * Felder Pad / Note Variation / Dauer / Velocity, DELETE, INSERT, PLAY, EDIT + MOVE/COPY/PASTE,
 * Step-Aufnahme mit REC bzw. OVER DUB im Stillstand.
 */
import type { NoteVariation } from '../../core/levels16';
import { copyEvents, moveEvents, pasteEvents, removeEvents } from '../../core/eventEdit';
import { padName } from '../../core/model';
import { barStarts, formatBBT, insertEvent, PPQ, seqLength, type NoteEvent } from '../../core/sequence';
import { gridTicks } from '../../core/timing';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import type { FrameBuffer } from '../display/framebuffer';
import type { MainActions } from './mainScreen';
import { TimingCorrectWindow } from './mainScreen';
import { drawSoftkeys, drawWindowFrame, pad2, step, stepEnum, type AppCtx, type NumericTarget, type Screen } from './screen';
import { Window } from './windows';

type Col = 'time' | 'pad' | 'vtype' | 'vval' | 'dur' | 'vel';
const COLS: readonly Col[] = ['time', 'pad', 'vtype', 'vval', 'dur', 'vel'];
const ROWS = 6;

/** Note-Variation-Typen wie im Handbuch: T Tune, F Filter, L Layer, A Attack, D Decay */
type VarType = '-' | 'T' | 'F' | 'L' | 'A' | 'D';
const VAR_TYPES: readonly VarType[] = ['-', 'T', 'F', 'L', 'A', 'D'];

export function varType(v?: NoteVariation): VarType {
  if (!v) return '-';
  if (v.tune !== undefined) return 'T';
  if (v.filterFreq !== undefined) return 'F';
  if (v.layerVelocity !== undefined) return 'L';
  if (v.attack !== undefined) return 'A';
  if (v.decay !== undefined) return 'D';
  return '-';
}

function varValue(v: NoteVariation | undefined): string {
  switch (varType(v)) {
    case 'T': { const t = v!.tune!; return (t < 0 ? '-' : '+') + pad2(Math.abs(t)); }
    case 'F': return String(v!.filterFreq).padStart(3);
    case 'L': return String(v!.layerVelocity).padStart(3);
    case 'A': return String(v!.attack).padStart(3);
    case 'D': return String(v!.decay).padStart(3);
    default: return '   ';
  }
}

function makeVariation(t: VarType, ev: NoteEvent): NoteVariation | undefined {
  switch (t) {
    case 'T': return { tune: 0 };
    case 'F': return { filterFreq: 50 };
    case 'L': return { layerVelocity: ev.velocity };
    case 'A': return { attack: 0 };
    case 'D': return { decay: 50 };
    default: return undefined;
  }
}

function adjustVariation(v: NoteVariation, d: number): NoteVariation {
  if (v.tune !== undefined) return { tune: step(v.tune, d, -36, 36) };
  if (v.filterFreq !== undefined) return { filterFreq: step(v.filterFreq, d, 0, 100) };
  if (v.layerVelocity !== undefined) return { layerVelocity: step(v.layerVelocity, d, 1, 127) };
  if (v.attack !== undefined) return { attack: step(v.attack, d, 0, 100) };
  if (v.decay !== undefined) return { decay: step(v.decay, d, 0, 100) };
  return v;
}

export class StepEditScreen implements Screen {
  readonly id = 'step';
  /** -1 = Kopfzeile (Now/View), sonst Index in der gefilterten Liste (Länge = „Ende“) */
  private sel = -1;
  private selCount = 1;
  private col: Col = 'time';
  private headCol: 'now' | 'view' = 'now';
  private view: number | 'ALL' = 'ALL';
  private lastNow = -1;
  private editKey = '';
  private asPlayed = new Map<number, { tick: number; pad: number; velocity: number; t0: number }>();
  private playing: { pad: number } | null = null;

  constructor(private ctx: AppCtx, private actions: MainActions) {}

  private get store() { return this.ctx.store; }
  private get now(): number { return this.actions.transport.tick; }
  private get running(): boolean { return this.actions.transport.state !== 'stopped'; }
  private get trackEvents(): NoteEvent[] { return this.store.activeTrack.events; }

  list(): NoteEvent[] {
    const v = this.view;
    return v === 'ALL' ? this.trackEvents : this.trackEvents.filter((e) => e.pad === v);
  }

  selected(): NoteEvent[] {
    if (this.sel < 0) return [];
    return this.list().slice(this.sel, this.sel + this.selCount);
  }

  onEnter(): void {
    this.lastNow = -1;
    this.syncToNow();
  }

  /** Liste folgt der Position (STEP/BAR, Now-Feld): erstes Event ab Now wird gewählt. */
  private syncToNow(): void {
    if (this.now === this.lastNow) return;
    this.lastNow = this.now;
    if (this.sel < 0) return;
    const cur = this.list()[this.sel];
    if (cur && cur.tick === this.now) return;
    const i = this.list().findIndex((e) => e.tick >= this.now);
    this.sel = i < 0 ? this.list().length : i;
    this.selCount = 1;
  }

  private selectRow(i: number): void {
    const list = this.list();
    this.sel = Math.min(list.length, Math.max(0, i));
    this.selCount = 1;
    const ev = list[this.sel];
    if (ev && !this.running) { this.actions.locate(ev.tick); this.lastNow = ev.tick; }
  }

  softkeys(): readonly string[] {
    if (this.ctx.ui.held.has('F3')) return ['', 'MOVE', 'EDIT', 'COPY', 'PASTE', ''];
    return ['T.C.', 'TRACK', 'EDIT', 'DELETE', 'INSERT', 'PLAY'];
  }

  animating(): boolean { return this.running; }

  render(fb: FrameBuffer): void {
    fb.clear();
    this.syncToNow();
    const seq = this.store.currentSequence;
    const head = this.sel < 0;
    fb.text(0, 0, 'Now:');
    fb.text(4 * CELL_W, 0, formatBBT(seq, this.now), head && this.headCol === 'now');
    fb.text(15 * CELL_W, 0, 'View:');
    fb.text(20 * CELL_W, 0, this.view === 'ALL' ? 'ALL' : padName(this.view), head && this.headCol === 'view');
    fb.text(25 * CELL_W, 0, `Tr:${pad2(this.store.state.activeTrack + 1)}`);
    if (this.ctx.ui.stepRec) fb.text(32 * CELL_W, 0, '●STEP', true);
    fb.hline(0, CELL_H, 240);

    const list = this.list();
    const focus = head ? Math.max(0, list.findIndex((e) => e.tick >= this.now)) : this.sel;
    const first = Math.max(0, Math.min(focus - 2, list.length + 1 - ROWS));
    const program = this.store.currentProgram;
    for (let r = 0; r < ROWS; r++) {
      const i = first + r;
      const y = CELL_H + 2 + r * CELL_H;
      if (i > list.length) break;
      const isSel = !head && i >= this.sel && i < this.sel + this.selCount;
      if (i === list.length) {
        fb.text(0, y, `${formatBBT(seq, seqLength(seq))} Ende der Sequenz`, isSel);
        continue;
      }
      const ev = list[i]!;
      const cells: [Col, number, string][] = [
        ['time', 0, formatBBT(seq, ev.tick)],
        ['pad', 10, padName(ev.pad)],
        ['vtype', 14, varType(ev.variation)],
        ['vval', 15, varValue(ev.variation)],
        ['dur', 20, String(ev.duration).padStart(4)],
        ['vel', 26, String(ev.velocity).padStart(3)],
      ];
      fb.text(19 * CELL_W, y, 'D');
      fb.text(25 * CELL_W, y, 'V');
      for (const [c, x, t] of cells) fb.text(x * CELL_W, y, t, isSel && (this.selCount > 1 || c === this.col));
      const name = this.store.sample(program.pads[ev.pad]?.layers[0].sampleId ?? null)?.name ?? '';
      fb.text(30 * CELL_W, y, name.slice(0, 10));
    }
    drawSoftkeys(fb, this.softkeys());
  }

  /** Änderung vorbereiten: einmal pro Feld/Event einen UNDO-Schnappschuss. */
  private beginEdit(key: string): void {
    if (this.editKey === key) return;
    this.editKey = key;
    this.store.snapshotForUndo();
  }

  private edit(fn: (events: NoteEvent[]) => void, key = `${Date.now()}`): void {
    this.beginEdit(key);
    this.store.updateSequence((q) => fn(q.tracks[this.store.state.activeTrack]!.events));
  }

  /** ANNAHME A-38: Schritt = T.C.-Wert, bei OFF 1/16 */
  private stepTicks(): number {
    const g = gridTicks(this.store.state.seqSettings.tc);
    return g <= 1 ? PPQ / 4 : g;
  }

  private stepDuration(): number {
    const o = this.ctx.ui.stepOpts;
    return Math.max(1, Math.round((this.stepTicks() * o.durPct) / 100));
  }

  /** Step-Aufnahme: Event an der aktuellen Position, danach optional einen Rasterschritt weiter. */
  private stepRecord(pad: number, velocity: number, duration: number, at = this.now): void {
    const seq = this.store.currentSequence;
    const len = seqLength(seq);
    if (at >= len) { this.ctx.flash('Ende der Sequenz'); return; }
    this.edit((events) => {
      insertEvent(events, { tick: at, pad, velocity, duration });
      this.store.activeTrack.used = true;
    });
    if (this.ctx.ui.stepOpts.autoStep && at === this.now) {
      const next = Math.min(len - 1, at + this.stepTicks());
      this.actions.locate(next);
    }
  }

  onEvent(e: HwEvent): boolean {
    const ui = this.ctx.ui;
    if (e.kind === 'pad') {
      if (this.running || !ui.stepRec) return false;
      const pad = ui.bank * 16 + e.pad;
      const velocity = ui.fullLevel ? ui.fullLevelValue : e.velocity;
      if (ui.stepOpts.duration === 'TC VALUE') {
        if (e.down) this.stepRecord(pad, velocity, this.stepDuration());
      } else if (e.down) {
        this.asPlayed.set(e.pad, { tick: this.now, pad, velocity, t0: performance.now() });
      } else {
        // AS PLAYED: gehaltene Zeit in Ticks umrechnen (Tempo der Sequenz)
        const a = this.asPlayed.get(e.pad);
        this.asPlayed.delete(e.pad);
        if (a) {
          const ticks = ((performance.now() - a.t0) / 1000) * (this.store.currentSequence.tempo / 60) * PPQ;
          this.stepRecord(a.pad, a.velocity, Math.max(1, Math.round(ticks)), a.tick);
        }
      }
      return false; // Pad klingt wie gewohnt
    }
    if (e.kind === 'wheel') { this.wheel(e.delta); return true; }
    if (e.kind !== 'button') return false;
    if (!e.down) {
      if (e.id === 'F6' && this.playing) { this.ctx.stopPadIndex(this.playing.pad); this.playing = null; }
      return e.id === 'F3';
    }
    const held = ui.held;
    if (held.has('F3') && e.id !== 'F3') return this.editCombo(e.id);
    switch (e.id) {
      case 'REC': case 'OVER_DUB':
        if (this.running) return false;
        ui.stepRec = !ui.stepRec;
        this.ctx.flash(ui.stepRec ? 'Step-Aufnahme: Pad schreibt an Now' : 'Step-Aufnahme aus');
        return true;
      case 'STOP': ui.stepRec = false; return false;
      case 'ERASE':
        if (this.running || this.sel < 0) return false;
        this.deleteSelected();
        return true;
      case 'CURSOR_UP':
        if (this.sel <= 0) { this.sel = -1; return true; }
        this.selectRow(this.sel - 1);
        return true;
      case 'CURSOR_DOWN':
        if (this.sel < 0) { this.selectRow(Math.max(0, this.list().findIndex((x) => x.tick >= this.now))); return true; }
        if (held.has('SHIFT')) { this.selCount = Math.min(this.list().length - this.sel, this.selCount + 1); return true; }
        this.selectRow(this.sel + 1);
        return true;
      case 'CURSOR_LEFT':
        if (this.sel < 0) { this.headCol = 'now'; return true; }
        if (this.col === 'time') { this.sel = -1; this.headCol = 'now'; return true; }
        this.col = COLS[COLS.indexOf(this.col) - 1]!;
        return true;
      case 'CURSOR_RIGHT':
        if (this.sel < 0) { this.headCol = 'view'; return true; }
        this.col = COLS[Math.min(COLS.length - 1, COLS.indexOf(this.col) + 1)]!;
        return true;
      case 'F1': this.ctx.openWindow(new TimingCorrectWindow(this.ctx, this.actions)); return true;
      case 'F2': this.ctx.flash(`Track ${pad2(this.store.state.activeTrack + 1)} – F2 halten + Wheel`); return true;
      case 'F3': return true;
      case 'F4': if (!this.running) this.deleteSelected(); return true;
      case 'F5': { // ANNAHME A-35: INSERT ohne Fenster
        if (this.running) return true;
        this.stepRecord(ui.selectedPad, 100, this.stepDuration());
        this.selectRow(this.list().findIndex((x) => x.tick === this.now && x.pad === ui.selectedPad));
        return true;
      }
      case 'F6': {
        const ev = this.selected()[0];
        if (ev) { this.ctx.playPadIndex(ev.pad, ev.velocity); this.playing = { pad: ev.pad }; }
        return true;
      }
      case 'WINDOW': this.ctx.openWindow(new StepOptionsWindow(this.ctx)); return true;
    }
    return false;
  }

  private editCombo(id: string): boolean {
    const sel = this.selected();
    switch (id) {
      case 'F2':
        if (sel.length && !this.running) this.ctx.openWindow(new MoveEventsWindow(this.ctx, this.actions, sel));
        return true;
      case 'F4':
        if (sel.length) { this.ctx.ui.clipboard = copyEvents(sel, sel[0]!.tick); this.ctx.flash(`${sel.length} Event(s) kopiert`); }
        return true;
      case 'F5': {
        const clip = this.ctx.ui.clipboard;
        if (!clip || this.running) return true;
        const len = seqLength(this.store.currentSequence);
        this.edit((events) => pasteEvents(events, clip, this.now, len));
        this.store.activeTrack.used = true;
        this.ctx.flash(`${clip.events.length} Event(s) eingefügt`);
        return true;
      }
    }
    return true;
  }

  private deleteSelected(): void {
    const sel = this.selected();
    if (!sel.length) return;
    this.edit((events) => removeEvents(events, sel));
    this.selCount = 1;
    this.sel = Math.min(this.sel, this.list().length);
  }

  /** NUMERIC: Pad, Dauer, Velocity des gewählten Events */
  numericTarget(): NumericTarget | null {
    const ev = this.selected()[0];
    if (!ev || this.running) return null;
    const set = (fn: () => void) => this.edit(fn);
    switch (this.col) {
      case 'pad': return { label: 'Pad 1-64', value: ev.pad + 1, min: 1, max: 64, set: (v) => set(() => { ev.pad = v - 1; }) };
      case 'dur': return { label: 'Dauer', value: ev.duration, min: 1, max: 9999, set: (v) => set(() => { ev.duration = v; }) };
      case 'vel': return { label: 'Velocity', value: ev.velocity, min: 1, max: 127, set: (v) => set(() => { ev.velocity = v; }) };
      default: return null;
    }
  }

  private wheel(raw: number): void {
    const ui = this.ctx.ui;
    if (ui.held.has('F2')) { this.store.setActiveTrack(this.store.state.activeTrack + raw); this.sel = -1; return; }
    const c = this.ctx.coarse() ? 10 : 1;
    if (this.sel < 0) {
      if (this.headCol === 'view') {
        const opts: (number | 'ALL')[] = ['ALL', ...Array.from({ length: 64 }, (_, i) => i)];
        this.view = stepEnum(opts, this.view, raw);
      } else if (!this.running) {
        // Now: Rasterschritte, mit SHIFT/TAP taktweise
        const seq = this.store.currentSequence;
        if (c > 1) {
          const starts = barStarts(seq);
          const t = raw > 0 ? starts.find((s) => s > this.now) ?? starts.at(-1)! : [...starts].reverse().find((s) => s < this.now) ?? 0;
          this.actions.locate(t);
        } else {
          const g = this.stepTicks();
          this.actions.locate(Math.min(seqLength(seq), Math.max(0, (raw > 0 ? Math.floor(this.now / g) + 1 : Math.ceil(this.now / g) - 1) * g)));
        }
      }
      return;
    }
    if (this.col === 'time') { this.selectRow(this.sel + raw); return; }
    const ev = this.selected()[0];
    if (!ev || this.running) return;
    const key = `${this.sel}:${this.col}:${ev.tick}`;
    this.edit(() => {
      switch (this.col) {
        case 'pad': ev.pad = step(ev.pad, raw * (c > 1 ? 16 : 1), 0, 63); break;
        case 'vtype': ev.variation = makeVariation(stepEnum(VAR_TYPES, varType(ev.variation), raw), ev); break;
        case 'vval': if (ev.variation) ev.variation = adjustVariation(ev.variation, raw * c); break;
        case 'dur': ev.duration = step(ev.duration, raw * c, 1, 9999); break;
        case 'vel': ev.velocity = step(ev.velocity, raw * c, 1, 127); break;
        default: break;
      }
    }, key);
  }
}

// ---------------------------------------------------------------------------
// MOVE (EDIT + F2): Auswahl an eine neue Position verschieben
// ---------------------------------------------------------------------------
export class MoveEventsWindow extends Window {
  readonly id = 'move-events';
  private to: number;
  constructor(ctx: AppCtx, private actions: MainActions, private events: NoteEvent[]) {
    super(ctx);
    this.to = events[0]?.tick ?? 0;
  }
  softkeys() { return ['', '', '', 'ABBR.', 'DO IT', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Events verschieben');
    const seq = this.ctx.store.currentSequence;
    fb.text(x, y, `Time=    ${formatBBT(seq, this.events[0]?.tick ?? 0)}  (${this.events.length} Event)`);
    fb.text(x, y + 2 * CELL_H, 'Move to:');
    fb.text(x + 9 * CELL_W, y + 2 * CELL_H, formatBBT(seq, this.to), true);
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const store = this.ctx.store;
    const len = seqLength(store.currentSequence);
    if (e.kind === 'wheel') {
      const g = gridTicks(store.state.seqSettings.tc);
      const s = this.ctx.ui.held.has('SHIFT') ? 1 : this.ctx.coarse() ? g * 4 : g;
      this.to = step(this.to, e.delta * s, 0, len - 1);
      return true;
    }
    if (e.kind !== 'button' || !e.down) return e.kind === 'pad';
    if (e.id === 'F4') { this.ctx.closeWindow(); return true; }
    if (e.id === 'F5') {
      store.snapshotForUndo();
      store.updateSequence((q) => moveEvents(q.tracks[store.state.activeTrack]!.events, this.events, this.to, len));
      this.actions.locate(this.to);
      this.ctx.closeWindow();
      this.ctx.flash('Verschoben');
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step Edit Options / Grid Options (WINDOW)
// ---------------------------------------------------------------------------
export class StepOptionsWindow extends Window {
  readonly id = 'step-options';
  private row = 0;
  constructor(ctx: AppCtx, private grid = false) { super(ctx); }
  softkeys() { return ['', '', '', 'CLOSE', '', '']; }
  private rows(): string[] { return this.grid ? ['sound', 'auto', 'dur', 'pct'] : ['auto', 'dur', 'pct']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, this.grid ? 'Grid Options' : 'Step Edit Options');
    const o = this.ctx.ui.stepOpts;
    const labels: Record<string, [string, string]> = {
      sound: ['Step sound:', o.stepSound ? 'ON ' : 'OFF'],
      auto: ['Auto step increment:', o.autoStep ? 'YES' : 'NO '],
      dur: ['Duration:', o.duration],
      pct: ['TC VALUE %:', o.duration === 'TC VALUE' ? String(o.durPct).padStart(3) : '---'],
    };
    this.rows().forEach((r, i) => {
      const [l, v] = labels[r]!;
      fb.text(x, y + i * CELL_H, l);
      fb.text(x + 21 * CELL_W, y + i * CELL_H, v.padEnd(9), this.row === i);
    });
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    const o = this.ctx.ui.stepOpts;
    const rows = this.rows();
    if (e.kind === 'wheel') {
      switch (rows[this.row]) {
        case 'sound': o.stepSound = e.delta > 0; break;
        case 'auto': o.autoStep = e.delta > 0; break;
        case 'dur': o.duration = e.delta > 0 ? 'TC VALUE' : 'AS PLAYED'; break;
        case 'pct': o.durPct = step(o.durPct, e.delta * (this.ctx.coarse() ? 10 : 1), 1, 100); break;
      }
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(rows.length - 1, this.row + 1); return true;
      case 'F4': this.ctx.closeWindow(); return true;
    }
    return false;
  }
}
