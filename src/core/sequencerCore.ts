/**
 * Sequencer-Kern: Transport, Wiedergabe, Aufnahme, Loop, Count-in, Metronom, Note Repeat.
 * Rein (keine Browser-API). Läuft im AudioWorklet; jeder Aufruf von `process` verarbeitet
 * einen Audioblock und meldet Ereignisse mit ihrem Frame-Versatz innerhalb des Blocks.
 * Verhalten nach MPC1000-Handbuch (Kap. 3) und JJOS2XL-Handbuch; Lücken als Annahmen markiert.
 */
import type { NoteVariation } from './levels16';
import {
  barStarts, insertEvent, loopRange, PPQ, seqLength, TEMPO_MAX, TEMPO_MIN, ticksPerBar,
  type NoteEvent, type Sequence,
} from './sequence';
import { gridTicks, nextStepAtOrAfter, timingCorrect, type TcValue } from './timing';

export type CountIn = 'OFF' | 'REC_ONLY' | 'REC_PLAY';
export type ClickRate = '1/4' | '1/4-3' | '1/8' | '1/8-3' | '1/16' | '1/16-3' | '1/32' | '1/32-3';
export const CLICK_RATES: readonly ClickRate[] = ['1/4', '1/4-3', '1/8', '1/8-3', '1/16', '1/16-3', '1/32', '1/32-3'];

export interface SeqSettings {
  tc: TcValue;
  swing: number;
  /** Timing-Correct-Stärke 0–100 % (JJOS2XL) */
  strength: number;
  countIn: CountIn;
  clickRate: ClickRate;
  clickInPlay: boolean;
  clickInRec: boolean;
  /** 0–200 (JJOS2XL) */
  clickLevel: number;
  tempoSource: 'SEQ' | 'MAS';
  masterTempo: number;
}

/** Werkseinstellungen laut MPC1000-Handbuch (Click-Fenster): Count in REC ONLY, In play NO, In rec YES, Rate 1/4. */
export function defaultSeqSettings(): SeqSettings {
  return {
    tc: '1/16', swing: 50, strength: 100, countIn: 'REC_ONLY', clickRate: '1/4',
    clickInPlay: false, clickInRec: true, clickLevel: 100, tempoSource: 'SEQ', masterTempo: 120,
  };
}

export function clickTicks(rate: ClickRate): number {
  return rate === '1/4' ? PPQ : rate === '1/4-3' ? (PPQ * 2) / 3 : gridTicks(rate as TcValue);
}

export type TransportState = 'stopped' | 'waiting' | 'countin' | 'playing';
export type RecMode = 'off' | 'rec' | 'dub';

export interface SeqOutput {
  noteOn(offset: number, programId: string, pad: number, velocity: number, variation?: NoteVariation): void;
  noteOff(offset: number, programId: string, pad: number): void;
  click(offset: number, accent: boolean): void;
}

interface PendingOff { dueFrame: number; programId: string; pad: number }
interface PendingRec { event: NoteEvent; startElapsed: number }
interface Repeat { programId: string; velocity: number; variation?: NoteVariation; nextTick: number }

export class SequencerCore {
  seq: Sequence | null = null;
  settings: SeqSettings = defaultSeqSettings();
  activeTrack = 0;
  /** SOLO (Main F6): nur dieser Track klingt; null = aus */
  soloTrack: number | null = null;
  state: TransportState = 'stopped';
  recMode: RecMode = 'off';
  /** Wiedergabeposition in Ticks (Gleitkomma, frame-genau fortgeschrieben) */
  position = 0;
  /** Tracks, deren Events sich durch Aufnahme/Löschen geändert haben */
  readonly dirtyTracks = new Set<number>();
  /** true, wenn sich die Taktzahl beim Aufnehmen geändert hat (Loop OFF) */
  barsChanged = false;

  private frameClock = 0;
  private elapsedTicks = 0;
  private countLeft = 0;
  private countPos = 0;
  private countBarLen = 384;
  private offs: PendingOff[] = [];
  private pendingRec = new Map<number, PendingRec>();
  /** in diesem Durchlauf aufgenommene Events – werden nicht sofort erneut gespielt/gelöscht */
  private freshEvents = new Set<NoteEvent>();
  /** auf den Loop-Anfang umgebrochene Aufnahmen: im nächsten Durchlauf einmal überspringen (schon live gespielt) */
  private skipNextPass = new Set<NoteEvent>();
  private erasePads = new Set<number>();
  private repeats = new Map<number, Repeat>();
  /** Frei laufende Note-Repeat-Uhr, wenn der Sequencer steht */
  private freeTicks = 0;
  private recStartBars = 0;
  private replacedPass = false;

  constructor(public sampleRate: number) {}

  // ---------- Zustand ----------

  get tempo(): number {
    const t = this.settings.tempoSource === 'MAS' ? this.settings.masterTempo : this.seq?.tempo ?? 120;
    return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, t));
  }

  get framesPerTick(): number {
    return (this.sampleRate * 60) / (this.tempo * PPQ);
  }

  get running(): boolean {
    return this.state === 'playing' || this.state === 'countin';
  }

  /**
   * Neue Sequenzdaten vom Hauptthread. Während einer Aufnahme bleibt der aufgenommene
   * Track aus dem Worklet maßgeblich, sonst gingen Noten zwischen zwei Meldungen verloren.
   */
  setSequence(seq: Sequence): void {
    if (this.seq && this.recMode !== 'off' && this.running) {
      const keep = this.seq.tracks[this.activeTrack];
      if (keep) seq.tracks[this.activeTrack] = keep;
      if (this.barsChanged) seq.bars = this.seq.bars;
    }
    this.seq = seq;
  }

  // ---------- Transport ----------

  /** PLAY START: von vorn (bei Loop ON vom ersten Loop-Takt); `fromBar1` = STOP gehalten (JJOS2XL). */
  playStart(fromBar1 = false): void {
    if (!this.seq) return;
    this.position = this.seq.loop && !fromBar1 ? loopRange(this.seq)[0] : 0;
    this.begin('off');
  }

  /** PLAY: ab aktueller Position. */
  play(): void {
    if (!this.seq) return;
    if (this.position >= seqLength(this.seq)) this.position = 0;
    this.begin('off');
  }

  /** REC/OVER DUB + PLAY START bzw. + PLAY */
  record(mode: 'rec' | 'dub', fromStart: boolean): void {
    if (!this.seq) return;
    if (fromStart) this.position = this.seq.loop ? loopRange(this.seq)[0] : 0;
    this.begin(mode);
  }

  /** Wait for Key (JJOS2XL): Aufnahme beginnt mit dem ersten Pad-Anschlag. */
  waitForKey(mode: 'rec' | 'dub'): void {
    if (!this.seq) return;
    this.recMode = mode;
    this.state = 'waiting';
  }

  /** Punch-in während der Wiedergabe (PLAY gehalten + REC/OVER DUB). */
  punchIn(mode: 'rec' | 'dub'): void {
    if (this.state !== 'playing') return;
    this.startRecording(mode);
  }

  /** Punch-out: REC/OVER DUB während der Aufnahme – Wiedergabe läuft weiter. */
  punchOut(): void {
    this.finishPendingRec();
    this.recMode = 'off';
  }

  stop(): void {
    this.finishPendingRec();
    if (this.seq && this.recMode !== 'off' && !this.seq.loop && this.barsChanged) {
      // Handbuch: Bei Loop OFF wird der Takt, in dem STOP gedrückt wurde, die neue Länge
      const starts = barStarts(this.seq);
      let bar = 1;
      while (bar < this.seq.bars.length && this.position >= starts[bar]!) bar++;
      this.seq.bars.length = Math.max(this.recStartBars, bar);
    }
    this.state = 'stopped';
    this.recMode = 'off';
    this.freshEvents.clear();
    this.skipNextPass.clear();
    this.erasePads.clear();
  }

  /** Position setzen (nur im Stillstand sinnvoll; Locate). */
  locate(tick: number): void {
    if (!this.seq) return;
    this.position = Math.max(0, Math.min(seqLength(this.seq), Math.round(tick)));
  }

  private begin(mode: RecMode): void {
    if (!this.seq) return;
    const count = this.settings.countIn === 'REC_PLAY' || (this.settings.countIn === 'REC_ONLY' && mode !== 'off');
    this.recMode = 'off';
    if (mode !== 'off') this.startRecording(mode);
    if (count) {
      const starts = barStarts(this.seq);
      let bar = 0;
      while (bar < this.seq.bars.length - 1 && this.position >= starts[bar + 1]!) bar++;
      this.countBarLen = ticksPerBar(this.seq.bars[bar] ?? { num: 4, den: 4 });
      this.countLeft = this.countBarLen;
      this.countPos = 0;
      this.state = 'countin';
    } else {
      this.state = 'playing';
    }
  }

  private startRecording(mode: 'rec' | 'dub'): void {
    this.recMode = mode;
    this.recStartBars = this.seq?.bars.length ?? 0;
    this.barsChanged = false;
    this.replacedPass = false;
    const t = this.seq?.tracks[this.activeTrack];
    if (t) { t.used = true; this.dirtyTracks.add(this.activeTrack); }
  }

  // ---------- Live-Eingaben ----------

  /** Pad-Anschlag während Aufnahme (Klang spielt der Aufrufer selbst). */
  recordNoteOn(pad: number, velocity: number, variation?: NoteVariation): void {
    if (this.state === 'waiting' && this.seq) {
      const mode = this.recMode === 'off' ? 'rec' : this.recMode;
      this.state = 'playing';
      this.startRecording(mode);
    }
    if (this.recMode === 'off' || !this.seq) return;
    if (this.state === 'countin') {
      // Anschläge kurz vor dem Ende des Count-ins gehören auf den Start (ANNAHME A-16)
      if (this.countLeft > gridTicks(this.settings.tc)) return;
    } else if (this.state !== 'playing') return;
    const track = this.seq.tracks[this.activeTrack];
    if (!track) return;
    const raw = this.state === 'countin' ? this.position : this.position;
    const tick = this.correctTick(raw);
    const wrapped = tick < raw - gridTicks(this.settings.tc);
    const ev: NoteEvent = { tick, pad, velocity, duration: 1, ...(variation && Object.keys(variation).length ? { variation } : {}) };
    insertEvent(track.events, ev);
    this.freshEvents.add(ev);
    if (wrapped) this.skipNextPass.add(ev);
    this.pendingRec.set(pad, { event: ev, startElapsed: this.elapsedTicks });
    this.dirtyTracks.add(this.activeTrack);
  }

  recordNoteOff(pad: number): void {
    const p = this.pendingRec.get(pad);
    if (!p) return;
    this.pendingRec.delete(pad);
    p.event.duration = Math.max(1, Math.round(this.elapsedTicks - p.startElapsed));
    this.dirtyTracks.add(this.activeTrack);
  }

  /** ERASE gehalten + Pads: Events dieser Pads werden gelöscht, solange der Playhead läuft. */
  setErasePads(pads: Iterable<number>): void {
    this.erasePads = new Set(pads);
  }

  /** Note Repeat: Pad wird im TC-Raster wiederholt, bis `repeatOff`. */
  repeatOn(programId: string, pad: number, velocity: number, variation?: NoteVariation): void {
    const tc = this.settings.tc === 'OFF' ? '1/16' : this.settings.tc;
    let nextTick: number;
    if (this.state === 'playing' && this.seq) {
      nextTick = this.nextRepeatTick(this.position, tc);
    } else {
      // ANNAHME A-17: im Stillstand läuft Note Repeat frei ab dem Anschlag (erster Schlag sofort)
      nextTick = this.freeTicks;
    }
    this.repeats.set(pad, { programId, velocity, ...(variation ? { variation } : {}), nextTick });
  }

  repeatOff(pad: number): void {
    this.repeats.delete(pad);
  }

  get repeatingPads(): number[] {
    return [...this.repeats.keys()];
  }

  // ---------- Verarbeitung eines Audioblocks ----------

  process(frames: number, out: SeqOutput): void {
    const fpt = this.framesPerTick;
    let done = 0;
    let guard = 0;
    while (done < frames && guard++ < 64) {
      const remaining = frames - done;
      if (this.state === 'countin') {
        const ticks = Math.min(remaining / fpt, this.countLeft);
        this.countClicks(this.countPos, this.countPos + ticks, done, fpt, out);
        this.countPos += ticks;
        this.countLeft -= ticks;
        done += Math.round(ticks * fpt);
        if (this.countLeft <= 1e-9) this.state = 'playing';
        continue;
      }
      if (this.state !== 'playing' || !this.seq) {
        this.processFreeRepeats(done, remaining, fpt, out);
        done = frames;
        break;
      }
      // Grenze dieses Abschnitts: Blockende, Loop-Ende oder Sequenzende
      const len = seqLength(this.seq);
      const recordingOpenEnd = this.recMode !== 'off' && !this.seq.loop;
      const [loopStart, loopEnd] = loopRange(this.seq);
      const boundary = this.seq.loop ? loopEnd : recordingOpenEnd ? Infinity : len;
      const a = this.position;
      const maxTicks = remaining / fpt;
      const b = Math.min(a + maxTicks, boundary);
      const segFrames = b === a + maxTicks ? remaining : Math.round((b - a) * fpt);
      this.segment(a, b, done, fpt, out);
      this.position = b;
      this.elapsedTicks += b - a;
      done += segFrames;
      if (recordingOpenEnd && this.position >= seqLength(this.seq)) {
        // Loop OFF + Aufnahme: Sequenz wächst Takt für Takt mit
        const last = this.seq.bars[this.seq.bars.length - 1] ?? { num: 4, den: 4 };
        this.seq.bars.push({ ...last });
        this.barsChanged = true;
      }
      if (b >= boundary) {
        if (this.seq.loop) {
          this.position = loopStart;
          this.onLoopWrap();
        } else {
          // ANNAHME A-18: Ende ohne Loop → Stopp, Position zurück an den Anfang
          this.stop();
          this.position = 0;
          break;
        }
      }
    }
    this.emitOffs(frames, out);
    this.frameClock += frames;
  }

  private onLoopWrap(): void {
    this.freshEvents = new Set(this.skipNextPass);
    this.skipNextPass.clear();
    // Handbuch: Nach dem ersten Durchlauf wechselt REC automatisch zu Overdub
    if (this.recMode === 'rec') { this.recMode = 'dub'; this.replacedPass = true; }
    for (const p of this.pendingRec.values()) this.freshEvents.add(p.event);
  }

  /** Ein zusammenhängender Tick-Abschnitt [a, b) ohne Sprung. */
  private segment(a: number, b: number, frameStart: number, fpt: number, out: SeqOutput): void {
    const seq = this.seq!;
    const at = (tick: number) => frameStart + framesInto(tick - a, fpt);
    // Aufnahme REC (ersetzen) bzw. ERASE: vorhandene Events im überstrichenen Bereich löschen
    if (this.recMode !== 'off') {
      const t = seq.tracks[this.activeTrack];
      if (t && (this.recMode === 'rec' || this.erasePads.size)) {
        const before = t.events.length;
        t.events = t.events.filter((e) =>
          this.freshEvents.has(e) || e.tick < a || e.tick >= b || (this.recMode !== 'rec' && !this.erasePads.has(e.pad)));
        if (t.events.length !== before) this.dirtyTracks.add(this.activeTrack);
      }
    }
    // Wiedergabe
    seq.tracks.forEach((t, index) => {
      if (!t.used || t.mute || t.events.length === 0) return;
      if (this.soloTrack !== null && index !== this.soloTrack) return;
      let i = lowerBound(t.events, a);
      for (; i < t.events.length; i++) {
        const e = t.events[i]!;
        if (e.tick >= b) break;
        if (this.freshEvents.has(e)) continue;
        const off = at(e.tick);
        const vel = Math.min(127, Math.max(1, Math.round((e.velocity * t.velPct) / 100)));
        out.noteOn(off, t.programId, e.pad, vel, e.variation);
        this.offs.push({ dueFrame: this.frameClock + off + Math.max(1, Math.round(e.duration * fpt)), programId: t.programId, pad: e.pad });
      }
    });
    // Metronom
    const clickOn = this.recMode !== 'off' ? this.settings.clickInRec : this.settings.clickInPlay;
    if (clickOn && this.settings.clickLevel > 0) this.sequenceClicks(a, b, at, out);
    // Note Repeat im Sequenzraster
    if (this.repeats.size) this.sequenceRepeats(a, b, at, out);
  }

  private sequenceClicks(a: number, b: number, at: (t: number) => number, out: SeqOutput): void {
    const seq = this.seq!;
    const starts = barStarts(seq);
    const step = clickTicks(this.settings.clickRate);
    const lastTs = seq.bars[seq.bars.length - 1] ?? { num: 4, den: 4 };
    for (let bar = 0; ; bar++) {
      const bs = bar < seq.bars.length ? starts[bar]! : starts[seq.bars.length]! + (bar - seq.bars.length) * ticksPerBar(lastTs);
      const be = bar < seq.bars.length ? starts[bar + 1]! : bs + ticksPerBar(lastTs);
      if (bs >= b) break;
      if (be <= a) continue;
      for (let k = 0; bs + k * step < be; k++) {
        const t = bs + k * step;
        if (t >= a && t < b) out.click(at(t), k === 0);
      }
    }
  }

  private countClicks(a: number, b: number, frameStart: number, fpt: number, out: SeqOutput): void {
    const step = clickTicks(this.settings.clickRate);
    for (let k = 0; k * step < this.countBarLen; k++) {
      const t = k * step;
      if (t >= a && t < b) out.click(frameStart + framesInto(t - a, fpt), k === 0);
    }
  }

  private nextRepeatTick(from: number, tc: TcValue): number {
    const seq = this.seq!;
    const starts = barStarts(seq);
    let bar = 0;
    while (bar < seq.bars.length - 1 && from >= starts[bar + 1]!) bar++;
    return nextStepAtOrAfter(from, tc, this.settings.swing, starts[bar]!).tick;
  }

  private sequenceRepeats(a: number, b: number, at: (t: number) => number, out: SeqOutput): void {
    const tc = this.settings.tc === 'OFF' ? '1/16' : this.settings.tc;
    const g = gridTicks(tc);
    for (const [pad, r] of this.repeats) {
      // Nach einem Loop-Sprung liegt nextTick hinter dem Abschnitt → neu einrasten
      if (r.nextTick > b + g || r.nextTick < a - g) r.nextTick = this.nextRepeatTick(a, tc);
      while (r.nextTick >= a && r.nextTick < b) {
        const off = at(r.nextTick);
        out.noteOn(off, r.programId, pad, r.velocity, r.variation);
        this.offs.push({ dueFrame: this.frameClock + off + Math.round(g * this.framesPerTick * 0.5), programId: r.programId, pad });
        if (this.recMode !== 'off') this.recordRepeatHit(pad, r, Math.round(r.nextTick), g);
        r.nextTick = this.nextRepeatTick(r.nextTick + 1, tc);
      }
    }
  }

  private recordRepeatHit(pad: number, r: Repeat, tick: number, grid: number): void {
    const t = this.seq?.tracks[this.activeTrack];
    if (!t) return;
    // ANNAHME A-19: aufgenommene Note-Repeat-Noten dauern ein halbes Raster
    const ev: NoteEvent = { tick, pad, velocity: r.velocity, duration: Math.max(1, Math.round(grid / 2)), ...(r.variation ? { variation: r.variation } : {}) };
    insertEvent(t.events, ev);
    this.freshEvents.add(ev);
    this.dirtyTracks.add(this.activeTrack);
  }

  private processFreeRepeats(frameStart: number, frames: number, fpt: number, out: SeqOutput): void {
    if (!this.repeats.size) { this.freeTicks += frames / fpt; return; }
    const tc = this.settings.tc === 'OFF' ? '1/16' : this.settings.tc;
    const g = gridTicks(tc);
    const a = this.freeTicks;
    const b = a + frames / fpt;
    for (const [pad, r] of this.repeats) {
      while (r.nextTick < b) {
        const off = frameStart + framesInto(r.nextTick - a, fpt);
        out.noteOn(off, r.programId, pad, r.velocity, r.variation);
        this.offs.push({ dueFrame: this.frameClock + off + Math.round(g * fpt * 0.5), programId: r.programId, pad });
        r.nextTick += g;
      }
    }
    this.freeTicks = b;
  }

  private emitOffs(frames: number, out: SeqOutput): void {
    if (!this.offs.length) return;
    const end = this.frameClock + frames;
    const keep: PendingOff[] = [];
    for (const o of this.offs) {
      if (o.dueFrame < end) out.noteOff(Math.max(0, o.dueFrame - this.frameClock), o.programId, o.pad);
      else keep.push(o);
    }
    this.offs = keep;
  }

  /** Alle Note-Offs sofort (STOP: gehaltene NOTE-ON-Pads verstummen). */
  flushOffs(out: SeqOutput): void {
    for (const o of this.offs) out.noteOff(0, o.programId, o.pad);
    this.offs = [];
  }

  private finishPendingRec(): void {
    for (const pad of [...this.pendingRec.keys()]) this.recordNoteOff(pad);
  }

  private correctTick(raw: number): number {
    const seq = this.seq!;
    const starts = barStarts(seq);
    let bar = 0;
    while (bar < seq.bars.length - 1 && raw >= starts[bar + 1]!) bar++;
    let tick = timingCorrect(raw, this.settings.tc, this.settings.swing, this.settings.strength, starts[bar]!);
    // Auf das Loop-Ende gerundet → gehört an den Loop-Anfang
    if (seq.loop) {
      const [ls, le] = loopRange(seq);
      if (tick >= le) tick = ls + (tick - le);
    }
    return Math.max(0, tick);
  }

  /** FIX: Timing Correct nachträglich auf den aktiven Track anwenden (optional nur bestimmte Pads). */
  fixTiming(pads?: Set<number>): void {
    const t = this.seq?.tracks[this.activeTrack];
    if (!t) return;
    const moved = t.events.map((e) => (pads && !pads.has(e.pad) ? e : { ...e, tick: this.correctTick(e.tick) }));
    moved.sort((x, y) => x.tick - y.tick);
    t.events = moved;
    this.dirtyTracks.add(this.activeTrack);
  }

  /** Nur für Tests: ob REC schon einen Durchlauf ersetzt hat. */
  get hasReplacedPass(): boolean { return this.replacedPass; }
}

/**
 * Frame-Versatz für einen Tick-Abstand. Abrunden mit kleiner Toleranz: Die Position läuft als
 * Gleitkommazahl mit, sonst landete ein Event durch Rundungsreste einen Frame zu früh.
 */
function framesInto(ticks: number, fpt: number): number {
  return Math.max(0, Math.floor(ticks * fpt + 1e-6));
}

function lowerBound(events: NoteEvent[], tick: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.tick < tick) lo = mid + 1; else hi = mid;
  }
  return lo;
}
