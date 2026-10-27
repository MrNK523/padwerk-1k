/**
 * MAIN – Sequencer-Hauptbildschirm (Felder nach MPC1000-Handbuch Kap. 3 und JJOS2XL „Main Screen“).
 * Eigene Anordnung auf 40 × 8 Zeichen. Softkeys wie JJOS2XL: T.C., CLICK, TR−, TR+, MUTE, SOLO.
 */
import { padName } from '../../core/model';
import { formatBBT, loopRange, MAX_BARS, setBarCount, TEMPO_MAX, TEMPO_MIN, TSIG_CHOICES, type Sequence } from '../../core/sequence';
import { CLICK_RATES, type CountIn, type RecMode, type TransportState } from '../../core/sequencerCore';
import { SWING_MAX, SWING_MIN, TC_VALUES } from '../../core/timing';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import type { FrameBuffer } from '../display/framebuffer';
import { drawSoftkeys, drawWindowFrame, pad2, step, stepEnum, type AppCtx, type NumericTarget, type Screen } from './screen';

export interface TransportView {
  tick: number;
  state: TransportState;
  recMode: RecMode;
}

export interface MainActions {
  transport: TransportView;
  locate(tick: number): void;
  fix(): void;
}

interface Field {
  row: number;
  col: number;
  width: number;
  text(): string;
  wheel?(raw: number): void;
  window?(): Screen | null;
}

export class MainScreen implements Screen {
  readonly id = 'main';
  private cursor = 0;
  private fields: Field[];

  constructor(private ctx: AppCtx, private actions: MainActions, private voices: () => number) {
    this.fields = this.buildFields();
  }

  private get store() { return this.ctx.store; }
  private get seq(): Sequence { return this.store.currentSequence; }
  private get running() { return this.actions.transport.state !== 'stopped'; }

  softkeys() { return ['T.C.', 'CLICK', 'TR-', 'TR+', 'MUTE', 'SOLO']; }

  private buildFields(): Field[] {
    const s = this.store;
    const set = s.state.seqSettings;
    const fine = () => this.ctx.ui.held.has('SHIFT');
    const stoppedOnly = (fn: () => void) => { if (this.running) this.ctx.flash('Erst STOP drücken'); else fn(); };
    return [
      { row: 0, col: 3, width: 16, text: () => `${pad2(s.state.currentSeq + 1)}-${s.state.sequences[s.state.currentSeq]?.name ?? '(unused)'}`,
        wheel: (r) => stoppedOnly(() => s.setCurrentSeq(step(s.state.currentSeq, r, 0, 98))) },
      { row: 0, col: 24, width: 5, text: () => this.tempo().toFixed(1).padStart(5),
        wheel: (r) => {
          const d = fine() ? r / 10 : r;
          const clampT = (t: number) => Math.round(step(t, d, TEMPO_MIN, TEMPO_MAX) * 10) / 10;
          if (set.tempoSource === 'MAS') s.updateSeqSettings({ masterTempo: clampT(set.masterTempo) });
          else s.updateSequence((q) => { q.tempo = clampT(q.tempo); });
        } },
      { row: 0, col: 30, width: 3, text: () => set.tempoSource,
        wheel: (r) => s.updateSeqSettings({ tempoSource: r > 0 ? 'MAS' : 'SEQ' }) },
      { row: 1, col: 5, width: 5, text: () => { const t = this.seq.bars[0]!; return `${t.num}/${t.den}`.padEnd(5); },
        // D-20: Taktart gilt hier für alle Takte; Taktart je Takt folgt mit dem Change-Tsig-Fenster (M5)
        wheel: (r) => stoppedOnly(() => s.updateSequence((q) => {
          const cur = q.bars[0]!;
          const i = Math.max(0, TSIG_CHOICES.findIndex((t) => t.num === cur.num && t.den === cur.den));
          const next = TSIG_CHOICES[Math.min(TSIG_CHOICES.length - 1, Math.max(0, i + r))]!;
          q.bars = q.bars.map(() => ({ ...next }));
        })) },
      { row: 1, col: 16, width: 3, text: () => String(this.seq.bars.length).padStart(3, '0'),
        wheel: (r) => stoppedOnly(() => s.updateSequence((q) => setBarCount(q, step(q.bars.length, r * (this.ctx.coarse() ? 10 : 1), 1, MAX_BARS)))) },
      { row: 1, col: 26, width: 3, text: () => (this.seq.loop ? 'ON ' : 'OFF'),
        wheel: (r) => s.updateSequence((q) => { q.loop = r > 0; }) },
      { row: 1, col: 30, width: 3, text: () => String(this.seq.loopFirst).padStart(3, '0'),
        wheel: (r) => s.updateSequence((q) => {
          q.loopFirst = step(q.loopFirst, r, 1, q.bars.length);
          if (q.loopLast !== null && q.loopLast < q.loopFirst) q.loopLast = q.loopFirst;
        }) },
      { row: 1, col: 34, width: 3, text: () => (this.seq.loopLast === null ? 'END' : String(this.seq.loopLast).padStart(3, '0')),
        wheel: (r) => s.updateSequence((q) => {
          const n = q.bars.length;
          const cur = q.loopLast ?? n + 1;
          const next = step(cur, r, q.loopFirst, n + 1);
          q.loopLast = next > n ? null : next;
        }) },
      { row: 2, col: 3, width: 16, text: () => `${pad2(s.state.activeTrack + 1)}-${s.activeTrack.name}${s.activeTrack.used ? '' : '*'}`,
        wheel: (r) => s.setActiveTrack(step(s.state.activeTrack, r, 0, 63)) },
      { row: 2, col: 31, width: 3, text: () => String(s.activeTrack.velPct).padStart(3),
        wheel: (r) => s.updateTrack(s.state.activeTrack, { velPct: step(s.activeTrack.velPct, r * (this.ctx.coarse() ? 10 : 1), 1, 200) }) },
      { row: 3, col: 4, width: 16, text: () => {
          const p = s.program(s.activeTrack.programId) ?? s.currentProgram;
          return `${pad2(s.state.programs.indexOf(p) + 1)}-${p.name}`;
        },
        wheel: (r) => {
          const list = s.state.programs;
          const i = Math.max(0, list.findIndex((p) => p.id === s.activeTrack.programId));
          s.setTrackProgram(list[step(i, r, 0, list.length - 1)]!.id);
        } },
      { row: 3, col: 26, width: 6, text: () => set.tc.padEnd(6),
        wheel: (r) => s.updateSeqSettings({ tc: stepEnum(TC_VALUES, set.tc, r) }),
        window: () => new TimingCorrectWindow(this.ctx, this.actions) },
      { row: 3, col: 36, width: 2, text: () => String(set.swing),
        wheel: (r) => s.updateSeqSettings({ swing: step(set.swing, r, SWING_MIN, SWING_MAX) }),
        window: () => new TimingCorrectWindow(this.ctx, this.actions) },
      { row: 4, col: 4, width: 9, text: () => formatBBT(this.seq, this.actions.transport.tick),
        wheel: (r) => stoppedOnly(() => {
          const starts = this.barStart(r);
          this.actions.locate(starts);
        }) },
    ];
  }

  private tempo(): number {
    const set = this.store.state.seqSettings;
    return set.tempoSource === 'MAS' ? set.masterTempo : this.seq.tempo;
  }

  /** Taktanfang relativ zur aktuellen Position (Wheel auf „Now“ springt taktweise). */
  private barStart(delta: number): number {
    const seq = this.seq;
    const tick = this.actions.transport.tick;
    let acc = 0;
    const starts = [0];
    for (const b of seq.bars) { acc += Math.round((b.num * 384) / b.den); starts.push(acc); }
    let bar = 0;
    while (bar < starts.length - 2 && tick >= starts[bar + 1]!) bar++;
    return starts[Math.min(starts.length - 2, Math.max(0, bar + delta))]!;
  }

  render(fb: FrameBuffer): void {
    const s = this.store;
    const ui = this.ctx.ui;
    const t = this.actions.transport;
    fb.clear();
    const lbl = (row: number, col: number, text: string) => fb.text(col * CELL_W, row * CELL_H, text);
    lbl(0, 0, 'Sq:');
    lbl(0, 20, 'BPM');
    lbl(1, 0, 'Tsig:');
    lbl(1, 11, 'Bars:');
    lbl(1, 21, 'Loop:');
    lbl(1, 33, '-');
    lbl(2, 0, 'Tr:');
    lbl(2, 20, 'DRUM');
    lbl(2, 26, 'Vel%');
    if (s.activeTrack.mute) lbl(2, 35, 'MUTE');
    else if (s.state.soloTrack === s.state.activeTrack) lbl(2, 35, 'SOLO');
    lbl(3, 0, 'Pgm:');
    lbl(3, 21, 'T.C.');
    lbl(3, 33, 'Sw');
    lbl(4, 0, 'Now:');
    const [ls, le] = loopRange(this.seq);
    const state = t.state === 'countin' ? 'VORZÄHLER' : t.state === 'waiting' ? 'WARTET' :
      t.state === 'playing' ? (t.recMode === 'rec' ? '● REC' : t.recMode === 'dub' ? '● DUB' : '▶ PLAY') : '■ STOP';
    lbl(4, 15, state);
    if (this.seq.loop) lbl(4, 26, `Loop ${formatBBT(this.seq, ls).slice(0, 3)}-${formatBBT(this.seq, le - 1).slice(0, 3)}`);
    this.fields.forEach((f, i) => fb.text(f.col * CELL_W, f.row * CELL_H, f.text().slice(0, f.width).padEnd(f.width), i === this.cursor));
    // Fortschrittsbalken innerhalb des Loops
    if (t.state === 'playing' && le > ls) {
      const w = Math.round(((t.tick - ls) / (le - ls)) * 240);
      fb.fillRect(0, 5 * CELL_H - 1, Math.max(0, Math.min(240, w)), 1, true);
    }
    const pad = s.currentProgram.pads[ui.selectedPad];
    const sample = s.sample(pad?.layers[0].sampleId ?? null);
    const vel = ui.lastVelocity === null ? '---' : String(ui.lastVelocity).padStart(3);
    lbl(5, 0, `Pad ${padName(ui.selectedPad)} ${(sample?.name ?? '(leer)').padEnd(16)} Vel ${vel}`.slice(0, 40));
    const info = ui.message || (t.state === 'waiting' ? 'Pad anschlagen startet die Aufnahme'
      : `Events ${s.activeTrack.events.length}  Stimmen ${this.voices()}/32${ui.fullLevel ? '  FULL' : ''}${ui.levels16On ? '  16LEV' : ''}`);
    lbl(6, 0, info.slice(0, 40));
    drawSoftkeys(fb, this.softkeys());
  }

  /** NUMERIC: Zahlenfelder des Main-Screens (Sq, BPM, Bars, Loop, Tr, Vel%, Swing) */
  numericTarget(): NumericTarget | null {
    const s = this.store;
    const set = s.state.seqSettings;
    const q = this.seq;
    switch (this.cursor) {
      case 0: return this.running ? null : { label: 'Sq', value: s.state.currentSeq + 1, min: 1, max: 99, set: (v) => s.setCurrentSeq(v - 1) };
      case 1: return { label: 'BPM', value: this.tempo(), min: TEMPO_MIN, max: TEMPO_MAX, decimals: 1, set: (v) => {
        if (set.tempoSource === 'MAS') s.updateSeqSettings({ masterTempo: v }); else s.updateSequence((x) => { x.tempo = v; });
      } };
      case 4: return this.running ? null : { label: 'Bars', value: q.bars.length, min: 1, max: MAX_BARS, set: (v) => s.updateSequence((x) => setBarCount(x, v)) };
      case 6: return { label: 'Loop von', value: q.loopFirst, min: 1, max: q.bars.length, set: (v) => s.updateSequence((x) => {
        x.loopFirst = v;
        if (x.loopLast !== null && x.loopLast < v) x.loopLast = v;
      }) };
      case 7: return { label: 'Loop bis', value: q.loopLast ?? q.bars.length, min: q.loopFirst, max: q.bars.length, set: (v) => s.updateSequence((x) => { x.loopLast = v; }) };
      case 8: return { label: 'Track', value: s.state.activeTrack + 1, min: 1, max: 64, set: (v) => s.setActiveTrack(v - 1) };
      case 9: return { label: 'Vel%', value: s.activeTrack.velPct, min: 1, max: 200, set: (v) => s.updateTrack(s.state.activeTrack, { velPct: v }) };
      case 12: return { label: 'Swing', value: set.swing, min: SWING_MIN, max: SWING_MAX, set: (v) => s.updateSeqSettings({ swing: v }) };
      default: return null;
    }
  }

  onEvent(e: HwEvent): boolean {
    const s = this.store;
    if (e.kind === 'wheel') { this.fields[this.cursor]?.wheel?.(e.delta); return true; }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_LEFT': this.cursor = Math.max(0, this.cursor - 1); return true;
      case 'CURSOR_RIGHT': this.cursor = Math.min(this.fields.length - 1, this.cursor + 1); return true;
      case 'CURSOR_UP': case 'CURSOR_DOWN': {
        const cur = this.fields[this.cursor]!;
        const row = cur.row + (e.id === 'CURSOR_UP' ? -1 : 1);
        const candidates = this.fields.map((f, i) => ({ f, i })).filter(({ f }) => f.row === row);
        if (candidates.length) {
          const best = candidates.reduce((a, b) => (Math.abs(b.f.col - cur.col) < Math.abs(a.f.col - cur.col) ? b : a));
          this.cursor = best.i;
        }
        return true;
      }
      case 'WINDOW': { const w = this.fields[this.cursor]?.window?.(); if (w) this.ctx.openWindow(w); return true; }
      case 'F1': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; this.ctx.openWindow(new TimingCorrectWindow(this.ctx, this.actions)); return true;
      case 'F2': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; this.ctx.openWindow(new ClickWindow(this.ctx)); return true;
      case 'F3': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; s.setActiveTrack(s.state.activeTrack - 1); return true;
      case 'F4': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; s.setActiveTrack(s.state.activeTrack + 1); return true;
      case 'F5': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; s.updateTrack(s.state.activeTrack, { mute: !s.activeTrack.mute }); return true;
      case 'F6': if (this.ctx.ui.held.has('TAP_TEMPO')) return false; s.setSolo(s.state.soloTrack === s.state.activeTrack ? null : s.state.activeTrack); return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Timing Correct (F1): Notenwert, Swing, Stärke; F5 FIX korrigiert den aktiven Track
// ---------------------------------------------------------------------------
export class TimingCorrectWindow implements Screen {
  readonly id = 'timing-correct';
  private row = 0;
  constructor(private ctx: AppCtx, private actions: MainActions) {}
  softkeys() { return ['', '', '', 'CLOSE', 'FIX', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Timing Correct');
    const s = this.ctx.store.state.seqSettings;
    const rows: [string, string][] = [['Notenwert:', s.tc], ['Swing %:', String(s.swing)], ['Stärke %:', String(s.strength)]];
    rows.forEach(([l, v], i) => {
      fb.text(x, y + i * CELL_H, l);
      fb.text(x + 12 * CELL_W, y + i * CELL_H, v.padEnd(6), this.row === i);
    });
    fb.text(x, y + 3 * CELL_H, 'F5 FIX: aktiven Track korrigieren');
    drawSoftkeys(fb, this.softkeys());
  }
  onEvent(e: HwEvent): boolean {
    const st = this.ctx.store;
    const s = st.state.seqSettings;
    if (e.kind === 'wheel') {
      if (this.row === 0) st.updateSeqSettings({ tc: stepEnum(TC_VALUES, s.tc, e.delta) });
      if (this.row === 1) st.updateSeqSettings({ swing: step(s.swing, e.delta, SWING_MIN, SWING_MAX) });
      if (this.row === 2) st.updateSeqSettings({ strength: step(s.strength, e.delta * (this.ctx.coarse() ? 10 : 1), 0, 100) });
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(2, this.row + 1); return true;
      case 'F4': case 'WINDOW': this.ctx.closeWindow(); return true;
      case 'F5':
        if (this.actions.transport.state !== 'stopped') { this.ctx.flash('FIX nur im Stillstand'); return true; }
        this.ctx.store.snapshotForUndo();
        this.actions.fix();
        this.ctx.flash(`Track korrigiert (${s.tc})`);
        this.ctx.closeWindow();
        return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Click/Metronom (F2)
// ---------------------------------------------------------------------------
const COUNT_INS: readonly CountIn[] = ['OFF', 'REC_ONLY', 'REC_PLAY'];
const COUNT_LABEL: Record<CountIn, string> = { OFF: 'OFF', REC_ONLY: 'REC ONLY', REC_PLAY: 'REC+PLAY' };

export class ClickWindow implements Screen {
  readonly id = 'click';
  private row = 0;
  constructor(private ctx: AppCtx) {}
  softkeys() { return ['', '', '', 'CLOSE', '', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Click / Metronom');
    const s = this.ctx.store.state.seqSettings;
    const left: [string, string][] = [['Count in:', COUNT_LABEL[s.countIn]], ['Rate:', s.clickRate], ['Pegel:', String(s.clickLevel)]];
    const right: [string, string][] = [['In play:', s.clickInPlay ? 'JA' : 'NEIN'], ['In rec:', s.clickInRec ? 'JA' : 'NEIN']];
    left.forEach(([l, v], i) => { fb.text(x, y + i * CELL_H, l); fb.text(x + 10 * CELL_W, y + i * CELL_H, v.padEnd(8), this.row === i); });
    right.forEach(([l, v], i) => { fb.text(x + 20 * CELL_W, y + i * CELL_H, l); fb.text(x + 29 * CELL_W, y + i * CELL_H, v.padEnd(4), this.row === i + 3); });
    drawSoftkeys(fb, this.softkeys());
  }
  onEvent(e: HwEvent): boolean {
    const st = this.ctx.store;
    const s = st.state.seqSettings;
    if (e.kind === 'wheel') {
      const d = e.delta;
      switch (this.row) {
        case 0: st.updateSeqSettings({ countIn: stepEnum(COUNT_INS, s.countIn, d) }); break;
        case 1: st.updateSeqSettings({ clickRate: stepEnum(CLICK_RATES, s.clickRate, d) }); break;
        case 2: st.updateSeqSettings({ clickLevel: step(s.clickLevel, d * (this.ctx.coarse() ? 10 : 1), 0, 200) }); break;
        case 3: st.updateSeqSettings({ clickInPlay: d > 0 }); break;
        case 4: st.updateSeqSettings({ clickInRec: d > 0 }); break;
      }
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = this.row === 3 ? 0 : this.row === 4 ? 3 : Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = this.row === 3 ? 4 : this.row < 2 ? this.row + 1 : this.row; return true;
      case 'CURSOR_RIGHT': if (this.row <= 1) this.row += 3; return true;
      case 'CURSOR_LEFT': if (this.row >= 3) this.row -= 3; return true;
      case 'F4': case 'WINDOW': this.ctx.closeWindow(); return true;
    }
    return false;
  }
}
