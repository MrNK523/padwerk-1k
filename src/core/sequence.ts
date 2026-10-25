/**
 * Sequenzen, Tracks und Events – rein und serialisierbar.
 * Auflösung 96 Ticks pro Viertel (MPC1000-Spezifikation „Resolution 96 parts per 1/4-note“).
 * Taktart pro Takt wie im Original (Change Tsig wirkt auf einzelne Takte).
 */
import type { NoteVariation } from './levels16';

export const PPQ = 96;
export const MAX_SEQUENCES = 99;
export const TRACKS_PER_SEQUENCE = 64;
export const MAX_BARS = 999;
export const TEMPO_MIN = 30;
export const TEMPO_MAX = 300;
/** ANNAHME A-15: Standard-Tempo neuer Sequenzen 120,0 BPM (im Handbuch nicht genannt). */
export const DEFAULT_TEMPO = 120;
/** Handbuch: neue Sequenz = 2 Takte, 4/4, Loop an. */
export const DEFAULT_BARS = 2;

export interface TimeSig { num: number; den: number }

export interface NoteEvent {
  tick: number;
  /** Pad-Index 0–63 (= Note 36–99) */
  pad: number;
  velocity: number;
  /** Dauer in Ticks (≥ 1) */
  duration: number;
  variation?: NoteVariation;
}

export type TrackType = 'DRUM';

export interface Track {
  name: string;
  /** false = ungenutzt (Anzeige „(unused)“) */
  used: boolean;
  type: TrackType;
  programId: string;
  /** Track stumm (Main-Screen F5 MUTE) */
  mute: boolean;
  /** Vel%: Wiedergabe-Velocity in Prozent 1–200 (JJOS2XL) */
  velPct: number;
  /** nach Tick sortiert */
  events: NoteEvent[];
}

export interface Sequence {
  name: string;
  tempo: number;
  /** Taktart je Takt; Länge = Anzahl Takte */
  bars: TimeSig[];
  loop: boolean;
  /** Loop-Bereich in Takten, 1-basiert; lastBar = null bedeutet END */
  loopFirst: number;
  loopLast: number | null;
  tracks: Track[];
}

export function ticksPerBar(ts: TimeSig): number {
  return Math.round((ts.num * PPQ * 4) / ts.den);
}

export function newTrack(index: number, programId: string): Track {
  return { name: `Track${String(index + 1).padStart(2, '0')}`, used: false, type: 'DRUM', programId, mute: false, velPct: 100, events: [] };
}

export function newSequence(index: number, programId: string, defaults?: Partial<Pick<Sequence, 'tempo' | 'loop'>> & { bars?: number; tsig?: TimeSig }): Sequence {
  const ts = defaults?.tsig ?? { num: 4, den: 4 };
  return {
    name: `Sequence${String(index + 1).padStart(2, '0')}`,
    tempo: defaults?.tempo ?? DEFAULT_TEMPO,
    bars: Array.from({ length: defaults?.bars ?? DEFAULT_BARS }, () => ({ ...ts })),
    loop: defaults?.loop ?? true,
    loopFirst: 1,
    loopLast: null,
    tracks: Array.from({ length: TRACKS_PER_SEQUENCE }, (_, i) => newTrack(i, programId)),
  };
}

/** Start-Tick jedes Takts plus Gesamtlänge als letztes Element. */
export function barStarts(seq: Pick<Sequence, 'bars'>): number[] {
  const out = [0];
  for (const ts of seq.bars) out.push(out[out.length - 1]! + ticksPerBar(ts));
  return out;
}

export function seqLength(seq: Pick<Sequence, 'bars'>): number {
  let t = 0;
  for (const ts of seq.bars) t += ticksPerBar(ts);
  return t;
}

/** Loop-Grenzen in Ticks [start, end). */
export function loopRange(seq: Sequence): [number, number] {
  const starts = barStarts(seq);
  const n = seq.bars.length;
  const first = Math.min(Math.max(1, seq.loopFirst), n);
  const last = seq.loopLast === null ? n : Math.min(Math.max(first, seq.loopLast), n);
  return [starts[first - 1]!, starts[last]!];
}

/** Tick → Takt (1-basiert), Schlag (1-basiert, in Einheiten des Nenners), Tick im Schlag. */
export function tickToBBT(seq: Pick<Sequence, 'bars'>, tick: number): { bar: number; beat: number; tick: number } {
  const starts = barStarts(seq);
  let bar = 0;
  while (bar < seq.bars.length - 1 && tick >= starts[bar + 1]!) bar++;
  if (tick >= starts[starts.length - 1]!) {
    // hinter dem Ende (z. B. Aufnahme mit Loop OFF): mit der letzten Taktart weiterzählen
    const last = seq.bars[seq.bars.length - 1] ?? { num: 4, den: 4 };
    const len = ticksPerBar(last);
    const over = tick - starts[starts.length - 1]!;
    bar = seq.bars.length + Math.floor(over / len);
    const inBar = over % len;
    const beatLen = (PPQ * 4) / last.den;
    return { bar: bar + 1, beat: Math.floor(inBar / beatLen) + 1, tick: Math.floor(inBar % beatLen) };
  }
  const ts = seq.bars[bar]!;
  const inBar = tick - starts[bar]!;
  const beatLen = (PPQ * 4) / ts.den;
  return { bar: bar + 1, beat: Math.floor(inBar / beatLen) + 1, tick: Math.floor(inBar % beatLen) };
}

/** Anzeige wie am Gerät: „001.01.00“ */
export function formatBBT(seq: Pick<Sequence, 'bars'>, tick: number): string {
  const b = tickToBBT(seq, Math.max(0, Math.floor(tick)));
  return `${String(b.bar).padStart(3, '0')}.${String(b.beat).padStart(2, '0')}.${String(b.tick).padStart(2, '0')}`;
}

/** Fügt ein Event sortiert ein (stabil: gleiche Ticks behalten die Einfüge-Reihenfolge). */
export function insertEvent(events: NoteEvent[], ev: NoteEvent): void {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.tick <= ev.tick) lo = mid + 1; else hi = mid;
  }
  events.splice(lo, 0, ev);
}

/** Change Bars: mehr Takte = leere Takte hinten; weniger = hintere Takte samt Events entfallen. */
export function setBarCount(seq: Sequence, count: number): void {
  const n = Math.min(MAX_BARS, Math.max(1, Math.round(count)));
  const last = seq.bars[seq.bars.length - 1] ?? { num: 4, den: 4 };
  while (seq.bars.length < n) seq.bars.push({ ...last });
  if (seq.bars.length > n) {
    seq.bars.length = n;
    const len = seqLength(seq);
    for (const t of seq.tracks) t.events = t.events.filter((e) => e.tick < len);
  }
  if (seq.loopLast !== null && seq.loopLast > n) seq.loopLast = n;
  if (seq.loopFirst > n) seq.loopFirst = n;
}

export const TSIG_CHOICES: readonly TimeSig[] = [
  { num: 4, den: 4 }, { num: 3, den: 4 }, { num: 2, den: 4 }, { num: 5, den: 4 }, { num: 6, den: 4 }, { num: 7, den: 4 },
  { num: 1, den: 4 }, { num: 6, den: 8 }, { num: 7, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 }, { num: 5, den: 8 },
  { num: 3, den: 8 }, { num: 7, den: 16 }, { num: 9, den: 16 }, { num: 15, den: 16 },
];
