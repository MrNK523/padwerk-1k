/**
 * GRID EDIT (MODE + PAD 15) nach JJOS2XL „GRID EDIT (DRUM)“: Pads als Zeilen, Zeit als Spalten.
 * Senkrechter Marker = Position, waagerechter Marker = Pad. Eingabe mit OVER DUB, COPY/PASTE/DELETE
 * mit Bereichsauswahl, EDIT-Felder, Zoom, ALL PAD und Loop Edit (1 Takt, 16 Schritte).
 */
import { copyEvents, eventAt, eventsInRange, neighbourEvent, pasteEvents, removeEvents, toggleStep } from '../../core/eventEdit';
import { padName } from '../../core/model';
import { barStarts, formatBBT, insertEvent, PPQ, seqLength, type NoteEvent } from '../../core/sequence';
import { gridTicks } from '../../core/timing';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import type { FrameBuffer } from '../display/framebuffer';
import type { MainActions } from './mainScreen';
import { drawSoftkeys, pad2, step, type AppCtx, type NumericTarget, type Screen } from './screen';
import { StepOptionsWindow } from './stepEditScreen';

/** JJOS2XL: Wheel bewegt den senkrechten Marker unabhängig vom Raster um 24 Ticks; ANNAHME A-32: Event „unter dem Marker“ = Beginn in [Marker, Marker + 24) */
const WHEEL_TICKS = 24;
const ROW_H = 6;
const GRID_Y = 13;
const VISIBLE_ROWS = 7;
const ZOOMS = [1, 2, 4, 8] as const;
/** Loop Edit: 16 Schritte à 1/16 in einem 4/4-Takt */
const LOOP_STEPS = 16;
const LOOP_STEP_TICKS = PPQ / 4;

interface Selection { t0: number; r0: number; moved: boolean; extra: boolean }

export class GridEditScreen implements Screen {
  readonly id = 'grid';
  row = 0;
  private topRow = 0;
  private zoomIndex = 1;
  allPad = false;
  private editField: 'vel' | 'dur' | null = null;
  private sel: { key: 'F2' | 'F4'; s: Selection } | null = null;
  private soundPad: number | null = null;
  private playPad: number | null = null;
  private asPlayed = new Map<number, { tick: number; pad: number; velocity: number; t0: number }>();
  /** Loop Edit: Takt (0-basiert) und gesicherte Loop-Einstellungen der Sequenz */
  loopEdit: { bar: number; saved: { loop: boolean; loopFirst: number; loopLast: number | null } } | null = null;

  constructor(private ctx: AppCtx, private actions: MainActions) {}

  private get store() { return this.ctx.store; }
  private get marker(): number { return this.actions.transport.tick; }
  private get running(): boolean { return this.actions.transport.state !== 'stopped'; }
  private get events(): NoteEvent[] { return this.store.activeTrack.events; }

  /** Pad-Index einer Zeile: 16 Pads der aktuellen Bank oder alle 64; ANNAHME A-33: oben = Pad 1 */
  padOfRow(r: number): number { return this.allPad ? r : this.ctx.ui.bank * 16 + r; }
  private get rowCount(): number { return this.allPad ? 64 : 16; }
  private get stepTicks(): number { const g = gridTicks(this.store.state.seqSettings.tc); return g <= 1 ? WHEEL_TICKS : g; }

  onEnter(): void { this.row = Math.min(this.row, this.rowCount - 1); }
  onLeave(): void { if (this.loopEdit) this.exitLoopEdit(); }

  // ---------- Ansicht ----------

  private view(): { from: number; to: number } {
    const seq = this.store.currentSequence;
    const starts = barStarts(seq);
    if (this.loopEdit) return { from: starts[this.loopEdit.bar]!, to: starts[this.loopEdit.bar + 1]! };
    const n = ZOOMS[this.zoomIndex]!;
    let bar = 0;
    while (bar < seq.bars.length - 1 && this.marker >= starts[bar + 1]!) bar++;
    const first = Math.floor(bar / n) * n;
    return { from: starts[first]!, to: starts[Math.min(seq.bars.length, first + n)]! };
  }

  private x(tick: number, v: { from: number; to: number }): number {
    return Math.floor(((tick - v.from) / Math.max(1, v.to - v.from)) * 240);
  }

  softkeys(): readonly string[] {
    const held = this.ctx.ui.held;
    if (held.has('F4')) return ['A BAR', '', '', 'DELETE', '', 'ALLPAD'];
    if (this.loopEdit) return ['LPEDIT', '', '', 'DELETE', '', ''];
    if (held.has('SHIFT')) return ['', this.allPad ? '16 PAD' : 'ALLPAD', '', '', 'ZOOM-', 'ZOOM+'];
    return ['LPEDIT', 'COPY', 'PASTE', 'DELETE', 'EDIT', 'PLAY'];
  }

  animating(): boolean { return this.running; }

  render(fb: FrameBuffer): void {
    fb.clear();
    const seq = this.store.currentSequence;
    const pad = this.padOfRow(this.row);
    const ev = eventAt(this.events, pad, this.marker, WHEEL_TICKS);
    const name = this.store.sample(this.store.currentProgram.pads[pad]?.layers[0].sampleId ?? null)?.name ?? '';
    fb.text(0, 0, formatBBT(seq, this.marker));
    fb.text(10 * CELL_W, 0, padName(pad));
    fb.text(14 * CELL_W, 0, name.slice(0, 10));
    fb.text(25 * CELL_W, 0, 'V');
    fb.text(26 * CELL_W, 0, ev ? String(ev.velocity).padStart(3) : '---', this.editField === 'vel');
    fb.text(30 * CELL_W, 0, 'D');
    fb.text(31 * CELL_W, 0, ev ? String(ev.duration).padStart(4) : '----', this.editField === 'dur');
    fb.text(36 * CELL_W, 0, `T${pad2(this.store.state.activeTrack + 1)}`);
    if (this.ctx.ui.stepRec) fb.invertRect(0, 0, 9 * CELL_W, CELL_H); // Eingabe aktiv: Zeit hervorgehoben
    if (this.loopEdit) this.renderLoopEdit(fb);
    else this.renderGrid(fb);
    drawSoftkeys(fb, this.softkeys());
  }

  private renderGrid(fb: FrameBuffer): void {
    const seq = this.store.currentSequence;
    const v = this.view();
    const starts = barStarts(seq);
    if (this.row < this.topRow) this.topRow = this.row;
    if (this.row >= this.topRow + VISIBLE_ROWS) this.topRow = this.row - VISIBLE_ROWS + 1;
    const bottom = GRID_Y + VISIBLE_ROWS * ROW_H;
    // Lineal oben: Takte lang, Viertel kurz; Taktgrenzen punktiert durch das Raster
    fb.hline(0, GRID_Y - 2, 240);
    for (let t = v.from; t < v.to; t += PPQ) {
      const bx = this.x(t, v);
      const isBar = starts.includes(t);
      fb.vline(bx, GRID_Y - (isBar ? 4 : 3), isBar ? 2 : 1);
      if (isBar) for (let y = GRID_Y; y < bottom; y += 2) fb.set(bx, y, true);
    }
    for (let t = v.from; t < v.to; t += this.stepTicks) fb.set(this.x(t, v), GRID_Y - 3, true);
    for (let vr = 0; vr < VISIBLE_ROWS; vr++) {
      const r = this.topRow + vr;
      if (r >= this.rowCount) break;
      const pad = this.padOfRow(r);
      const y0 = GRID_Y + vr * ROW_H;
      for (const e of this.events) {
        if (e.pad !== pad || e.tick >= v.to || e.tick + e.duration <= v.from) continue;
        const x0 = Math.max(0, this.x(e.tick, v));
        const x1 = Math.min(240, Math.max(x0 + 2, this.x(e.tick + e.duration, v)));
        fb.fillRect(x0, y0 + 2, x1 - x0, 2);
        fb.fillRect(x0, y0 + 1, 2, ROW_H - 2);
      }
      // waagerechter Marker: Zeile oben und unten punktiert eingefasst
      if (r === this.row) for (let xx = 0; xx < 240; xx += 2) { fb.set(xx, y0, true); fb.set(xx + 1, y0 + ROW_H - 1, true); }
    }
    // Auswahl (COPY/DELETE gehalten)
    if (this.sel) {
      const [t0, t1, r0, r1] = this.selBounds();
      const y0 = GRID_Y + Math.max(0, r0 - this.topRow) * ROW_H;
      const y1 = GRID_Y + Math.min(VISIBLE_ROWS, r1 - this.topRow + 1) * ROW_H;
      const a = Math.max(0, this.x(t0, v));
      const b = Math.min(240, this.x(t1, v));
      for (let xx = a; xx < b; xx += 2) { fb.set(xx, y0, true); fb.set(xx, y1 - 1, true); }
    }
    // senkrechter Marker: durchgehende Linie, über Events invertiert
    const mx = this.x(this.marker, v);
    for (let y = GRID_Y - 4; y < bottom; y++) fb.set(mx, y, !fb.get(mx, y) || y < GRID_Y);
  }

  private renderLoopEdit(fb: FrameBuffer): void {
    const seq = this.store.currentSequence;
    const bar = this.loopEdit!.bar;
    const start = barStarts(seq)[bar]!;
    const pad = this.padOfRow(this.row);
    fb.text(0, CELL_H + 2, `LOOP EDIT  Takt ${String(bar + 1).padStart(3, '0')}  Pad ${padName(pad)}`);
    const w = 14;
    const gap = 1;
    const y = 3 * CELL_H;
    const playing = this.running ? Math.floor((this.marker - start) / LOOP_STEP_TICKS) : -1;
    for (let i = 0; i < LOOP_STEPS; i++) {
      const x = i * (w + gap) + (i >= 8 ? 0 : 0);
      const on = !!eventAt(this.events, pad, start + i * LOOP_STEP_TICKS, LOOP_STEP_TICKS);
      fb.rect(x, y, w, w);
      if (on) fb.fillRect(x + 2, y + 2, w - 4, w - 4);
      if (i % 4 === 0) fb.hline(x, y + w + 1, w);
      if (i === playing) fb.invertRect(x, y, w, w);
    }
    fb.text(0, 5 * CELL_H + 4, 'Pads 1–16 = Schritte, ▲▼ = Pad');
  }

  private selBounds(): [number, number, number, number] {
    const s = this.sel!.s;
    const t0 = Math.min(s.t0, this.marker);
    const t1 = Math.max(s.t0, this.marker) + WHEEL_TICKS;
    return [t0, t1, Math.min(s.r0, this.row), Math.max(s.r0, this.row)];
  }

  private selectedEvents(): NoteEvent[] {
    const [t0, t1, r0, r1] = this.selBounds();
    const pads = new Set(Array.from({ length: r1 - r0 + 1 }, (_, i) => this.padOfRow(r0 + i)));
    return eventsInRange(this.events, t0, t1, pads);
  }

  // ---------- Bearbeiten ----------

  private edit(fn: (events: NoteEvent[]) => void, snapshot = true): void {
    if (snapshot) this.store.snapshotForUndo();
    this.store.updateSequence((q) => fn(q.tracks[this.store.state.activeTrack]!.events));
  }

  private moveMarker(t: number): void {
    const len = seqLength(this.store.currentSequence);
    const tick = Math.min(len - 1, Math.max(0, Math.round(t)));
    this.actions.locate(tick);
    if (this.sel) this.sel.s.moved = true;
    // Step sound: Events an der neuen Markerposition anspielen
    if (this.soundPad !== null) { this.ctx.stopPadIndex(this.soundPad); this.soundPad = null; }
    if (this.ctx.ui.stepOpts.stepSound) {
      const hits = eventsInRange(this.events, tick, tick + WHEEL_TICKS);
      for (const e of hits) { this.ctx.playPadIndex(e.pad, e.velocity); this.soundPad = e.pad; }
    }
  }

  private setRow(r: number): void {
    this.row = Math.min(this.rowCount - 1, Math.max(0, r));
    if (this.sel) this.sel.s.moved = true;
  }

  private insertAt(tick: number, pad: number, velocity: number, duration: number): void {
    const len = seqLength(this.store.currentSequence);
    if (tick >= len) return;
    this.edit((events) => { insertEvent(events, { tick, pad, velocity, duration }); });
    this.store.activeTrack.used = true;
  }

  // ---------- Loop Edit ----------

  private enterLoopEdit(): void {
    const seq = this.store.currentSequence;
    const starts = barStarts(seq);
    let bar = 0;
    while (bar < seq.bars.length - 1 && this.marker >= starts[bar + 1]!) bar++;
    const ts = seq.bars[bar]!;
    if (ts.num !== 4 || ts.den !== 4) { this.ctx.flash('Loop Edit nur in 4/4-Takten'); return; }
    this.loopEdit = { bar, saved: { loop: seq.loop, loopFirst: seq.loopFirst, loopLast: seq.loopLast } };
    // Takt in Schleife abspielen (JJOS2XL); Einstellungen beim Verlassen zurück
    this.store.updateSequence((q) => { q.loop = true; q.loopFirst = bar + 1; q.loopLast = bar + 1; });
    this.ctx.ui.stepRec = true;
    if (!this.running) this.actions.locate(starts[bar]!);
  }

  private exitLoopEdit(): void {
    const le = this.loopEdit;
    if (!le) return;
    this.loopEdit = null;
    this.store.updateSequence((q) => { Object.assign(q, le.saved); });
  }

  // ---------- Ereignisse ----------

  onEvent(e: HwEvent): boolean {
    const ui = this.ctx.ui;
    if (e.kind === 'pad') return this.onPad(e);
    if (e.kind === 'wheel') { this.wheel(e.delta); return true; }
    if (e.kind !== 'button') return false;
    if (!e.down) return this.buttonUp(e.id);
    const held = ui.held;
    const shift = held.has('SHIFT');
    if (held.has('F4') && e.id !== 'F4') return this.deleteCombo(e.id);
    switch (e.id) {
      case 'OVER_DUB':
        if (this.running) return false;
        ui.stepRec = !ui.stepRec;
        this.ctx.flash(ui.stepRec ? 'Eingabe: Pad schreibt am Marker' : 'Eingabe aus');
        return true;
      case 'STOP': if (!this.loopEdit) ui.stepRec = false; return false;
      case 'CURSOR_UP': this.setRow(this.row - 1); return true;
      case 'CURSOR_DOWN': this.setRow(this.row + 1); return true;
      case 'CURSOR_LEFT': case 'STEP_PREV':
        if (this.running) return true;
        if (this.editField) { this.editField = 'vel'; return true; }
        this.moveMarker(Math.ceil(this.marker / this.stepTicks) * this.stepTicks - this.stepTicks);
        return true;
      case 'CURSOR_RIGHT': case 'STEP_NEXT':
        if (this.running) return true;
        if (this.editField) { this.editField = 'dur'; return true; }
        this.moveMarker(Math.floor(this.marker / this.stepTicks) * this.stepTicks + this.stepTicks);
        return true;
      case 'BAR_PREV': case 'BAR_NEXT': {
        if (this.running || this.loopEdit) return true;
        const dir = e.id === 'BAR_NEXT' ? 1 : -1;
        if (shift) {
          // SHIFT + BAR: zum nächsten bzw. vorigen Event
          const n = neighbourEvent(this.events, this.marker, dir);
          if (n) { this.moveMarker(n.tick); const r = this.rowOfPad(n.pad); if (r !== null) this.setRow(r); }
          return true;
        }
        const starts = barStarts(this.store.currentSequence);
        const t = dir > 0 ? starts.find((s) => s > this.marker) ?? starts.at(-1)! : [...starts].reverse().find((s) => s < this.marker) ?? 0;
        this.moveMarker(t);
        return true;
      }
      case 'WINDOW': this.ctx.openWindow(new StepOptionsWindow(this.ctx, true)); return true;
    }
    if (!/^F[1-6]$/.test(e.id)) return false;
    if (shift) {
      if (e.id === 'F2') { this.allPad = !this.allPad; this.row = this.allPad ? this.padOfRowInBank(this.row) : this.row % 16; }
      if (e.id === 'F5') this.zoomIndex = Math.min(ZOOMS.length - 1, this.zoomIndex + 1);
      if (e.id === 'F6') this.zoomIndex = Math.max(0, this.zoomIndex - 1);
      return true;
    }
    if (this.loopEdit) {
      if (e.id === 'F1') { this.exitLoopEdit(); ui.stepRec = false; }
      if (e.id === 'F4') { this.loopDeleteRow(); }
      return true;
    }
    switch (e.id) {
      case 'F1': this.enterLoopEdit(); return true;
      case 'F2': this.sel = { key: 'F2', s: { t0: this.marker, r0: this.row, moved: false, extra: false } }; return true;
      case 'F3': { // ANNAHME A-37: Pads bleiben, Zeit ab Marker
        const clip = ui.clipboard;
        if (!clip || this.running) return true;
        this.edit((events) => pasteEvents(events, clip, this.marker, seqLength(this.store.currentSequence)));
        this.store.activeTrack.used = true;
        this.ctx.flash(`${clip.events.length} Event(s) eingefügt`);
        return true;
      }
      case 'F4': this.sel = { key: 'F4', s: { t0: this.marker, r0: this.row, moved: false, extra: false } }; return true;
      case 'F5':
        this.editField = this.editField ? null : 'vel';
        if (this.editField) this.store.snapshotForUndo(); // Änderungen der Felder mit UNDO zurücknehmbar
        return true;
      case 'F6': {
        const pad = this.padOfRow(this.row);
        const ev = eventAt(this.events, pad, this.marker, WHEEL_TICKS);
        this.ctx.playPadIndex(pad, ev?.velocity ?? 100);
        this.playPad = pad;
        return true;
      }
    }
    return false;
  }

  private padOfRowInBank(r: number): number { return this.ctx.ui.bank * 16 + r; }

  private rowOfPad(pad: number): number | null {
    if (this.allPad) return pad;
    const r = pad - this.ctx.ui.bank * 16;
    return r >= 0 && r < 16 ? r : null;
  }

  private buttonUp(id: string): boolean {
    if (id === 'F6' && this.playPad !== null) { this.ctx.stopPadIndex(this.playPad); this.playPad = null; return true; }
    if ((id === 'F2' || id === 'F4') && this.sel?.key === id) {
      const s = this.sel.s;
      const list = s.moved ? this.selectedEvents() : [eventAt(this.events, this.padOfRow(this.row), this.marker, WHEEL_TICKS)].filter((x): x is NoteEvent => !!x);
      this.sel = null;
      if (s.extra) return true;
      if (id === 'F2') {
        if (list.length) {
          const origin = s.moved ? Math.min(s.t0, this.marker) : this.marker;
          this.ctx.ui.clipboard = copyEvents(list, origin);
          this.ctx.flash(`${list.length} Event(s) kopiert`);
        }
      } else if (list.length && !this.running) {
        this.edit((events) => removeEvents(events, list));
        this.ctx.flash(`${list.length} Event(s) gelöscht`);
      }
      return true;
    }
    return /^F[1-6]$/.test(id);
  }

  /** F4 gehalten: F1 = alle Events des Takts, F6 = alle Pads am Marker */
  private deleteCombo(id: string): boolean {
    if (this.running) return true;
    const seq = this.store.currentSequence;
    if (id === 'F1' || id === 'F6') {
      let list: NoteEvent[];
      if (id === 'F1') {
        const starts = barStarts(seq);
        let bar = 0;
        while (bar < seq.bars.length - 1 && this.marker >= starts[bar + 1]!) bar++;
        list = eventsInRange(this.events, starts[bar]!, starts[bar + 1]!);
      } else list = eventsInRange(this.events, this.marker, this.marker + WHEEL_TICKS);
      if (this.sel) this.sel.s.extra = true;
      this.edit((events) => removeEvents(events, list));
      this.ctx.flash(`${list.length} Event(s) gelöscht`);
      return true;
    }
    if (id === 'CURSOR_UP') { this.setRow(this.row - 1); return true; }
    if (id === 'CURSOR_DOWN') { this.setRow(this.row + 1); return true; }
    return true;
  }

  private loopDeleteRow(): void {
    const seq = this.store.currentSequence;
    const starts = barStarts(seq);
    const bar = this.loopEdit!.bar;
    const pad = this.padOfRow(this.row);
    const list = eventsInRange(this.events, starts[bar]!, starts[bar + 1]!, new Set([pad]));
    this.edit((events) => removeEvents(events, list));
  }

  private onPad(e: HwEvent & { kind: 'pad' }): boolean {
    const ui = this.ctx.ui;
    const velocity = ui.fullLevel ? ui.fullLevelValue : e.velocity;
    if (this.loopEdit) {
      if (!e.down) return true;
      // Pads 1–16 schalten die 16 Schritte des gewählten Pads im Takt um (ANNAHME A-34: Velocity des Anschlags)
      const start = barStarts(this.store.currentSequence)[this.loopEdit.bar]!;
      const pad = this.padOfRow(this.row);
      const dur = Math.max(1, Math.round((LOOP_STEP_TICKS * ui.stepOpts.durPct) / 100));
      let on = false;
      this.edit((events) => { on = toggleStep(events, pad, start + e.pad * LOOP_STEP_TICKS, LOOP_STEP_TICKS, { velocity, duration: dur }); });
      this.store.activeTrack.used = true;
      if (on && !this.running) { this.ctx.playPadIndex(pad, velocity); this.ctx.stopPadIndex(pad); }
      return true;
    }
    const pad = ui.bank * 16 + e.pad;
    if (e.down) { const r = this.rowOfPad(pad); if (r !== null) this.row = r; }
    if (this.running || !ui.stepRec) return false;
    if (ui.stepOpts.duration === 'TC VALUE') {
      if (e.down) {
        const dur = Math.max(1, Math.round((this.stepTicks * ui.stepOpts.durPct) / 100));
        this.insertAt(this.marker, pad, velocity, dur);
        if (ui.stepOpts.autoStep) this.moveMarker(this.marker + this.stepTicks);
      }
    } else if (e.down) {
      this.asPlayed.set(e.pad, { tick: this.marker, pad, velocity, t0: performance.now() });
    } else {
      const a = this.asPlayed.get(e.pad);
      this.asPlayed.delete(e.pad);
      if (a) {
        const ticks = ((performance.now() - a.t0) / 1000) * (this.store.currentSequence.tempo / 60) * PPQ;
        this.insertAt(a.tick, a.pad, a.velocity, Math.max(1, Math.round(ticks)));
        if (ui.stepOpts.autoStep && this.marker === a.tick) this.moveMarker(a.tick + this.stepTicks);
      }
    }
    return false;
  }

  /** NUMERIC im EDIT-Feld: Velocity bzw. Dauer des Events unter dem Marker */
  numericTarget(): NumericTarget | null {
    if (!this.editField || this.running) return null;
    const ev = eventAt(this.events, this.padOfRow(this.row), this.marker, WHEEL_TICKS);
    if (!ev) return null;
    return this.editField === 'vel'
      ? { label: 'Velocity', value: ev.velocity, min: 1, max: 127, set: (v) => this.edit(() => { ev.velocity = v; }, false) }
      : { label: 'Dauer', value: ev.duration, min: 1, max: 9999, set: (v) => this.edit(() => { ev.duration = v; }, false) };
  }

  private wheel(raw: number): void {
    const ui = this.ctx.ui;
    if (this.loopEdit) { this.setRow(this.row + raw); return; }
    if (this.editField) {
      const ev = eventAt(this.events, this.padOfRow(this.row), this.marker, WHEEL_TICKS);
      if (!ev || this.running) return;
      const c = this.ctx.coarse() ? 10 : 1;
      this.edit(() => {
        if (this.editField === 'vel') ev.velocity = step(ev.velocity, raw * c, 1, 127);
        else ev.duration = step(ev.duration, raw * c, 1, 9999);
      }, false);
      return;
    }
    if (this.running) return;
    // Wheel: 24 Ticks; mit NOTE REPEAT (TAP) im Raster; mit SHIFT 1 Tick (JJOS2XL)
    const s = ui.held.has('SHIFT') ? 1 : ui.held.has('TAP_TEMPO') ? this.stepTicks : WHEEL_TICKS;
    this.moveMarker(this.marker + raw * s);
  }
}
