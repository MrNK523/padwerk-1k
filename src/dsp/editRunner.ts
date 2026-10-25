/**
 * Sample-Edit-Fenster als reine Funktion: Bearbeitung ausführen und Start/Ende/Loop/Chops
 * an die neue Länge anpassen. Rein, ohne Browser-API – unit-getestet.
 */
import { clampPlayback, type SamplePlayback } from '../core/model';
import {
  bitConvert, combine, deleteRange, discard, fade, insertSilence, mix, normalize, reverse, ringMod, silence, stereoToMono,
  type Channels,
} from './sampleEdit';

export const EDIT_KINDS = [
  'DISCARD', 'DELETE', 'SILENCE', 'EXTRACT', 'NORMALIZE', 'REVERSE', 'INSERT SILENCE', 'FADE IN', 'FADE OUT',
  'STEREO>MONO', 'BIT CONVERT', 'RING MOD', 'COMBINE', 'MIX', 'COPY',
] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

/** Wie das Ergebnis übernommen wird (MPC1000-Handbuch Kap. 11). */
export function editResult(kind: EditKind): 'inplace' | 'keepRetry' | 'newSample' {
  switch (kind) {
    case 'DISCARD': case 'NORMALIZE': case 'REVERSE': case 'STEREO>MONO': return 'inplace';
    case 'EXTRACT': case 'COPY': return 'newSample';
    default: return 'keepRetry';
  }
}

export interface EditParams {
  silenceMs: number;
  bits: number;
  ringFreq: number;
  ringWave: 'SINE' | 'SQUARE';
  ringMix: number;
  levelA: number;
  levelB: number;
  /** Sample B für COMBINE/MIX */
  other?: { channels: Channels; sampleRate: number };
}

export const defaultEditParams = (): EditParams => ({
  silenceMs: 100, bits: 8, ringFreq: 440, ringWave: 'SINE', ringMix: 5, levelA: 100, levelB: 100,
});

export interface EditInput {
  channels: Channels;
  sampleRate: number;
  play: SamplePlayback;
  /** Bearbeitungsbereich: TRIM = Start–Ende, Non-Destructive Chop = gewählter Chop */
  range: [number, number];
  /** true = Bereich ist ein Chop (NORMALIZE/REVERSE wirken dann nur dort) */
  rangeIsChop: boolean;
}

export interface EditOutput { channels: Channels; play: SamplePlayback }

/** Position nach einer Längenänderung bei `at` um `delta` Frames verschieben (Lösch-/Einfügebereich zieht zusammen). */
function shiftPoint(x: number, at: number, delta: number): number {
  if (delta < 0 && x > at) return Math.max(at, x + delta);
  if (delta > 0 && x >= at) return x + delta;
  return x;
}

function shiftPlay(p: SamplePlayback, at: number, delta: number, frames: number): SamplePlayback {
  const f = (x: number) => shiftPoint(x, at, delta);
  return clampPlayback({
    ...p, start: f(p.start), end: f(p.end), loopPoint: f(p.loopPoint),
    chops: p.chops.map((r) => ({ start: f(r.start), end: f(r.end) })),
  }, frames);
}

export function runEdit(kind: EditKind, input: EditInput, params: EditParams): EditOutput {
  const { channels: ch, sampleRate: sr, play } = input;
  const [s, e] = input.range;
  const len = ch[0]?.length ?? 0;
  const whole: [number, number] = input.rangeIsChop ? [s, e] : [0, len];
  const same = (out: Channels): EditOutput => ({ channels: out, play: clampPlayback(play, out[0]?.length ?? 0) });
  switch (kind) {
    case 'DISCARD': {
      const out = discard(ch, s, e);
      return { channels: out, play: shiftPlay(shiftPlay(play, e, -(len - e), e), 0, -s, out[0]?.length ?? 0) };
    }
    case 'DELETE': {
      const out = deleteRange(ch, s, e);
      const n = out[0]?.length ?? 0;
      const p = shiftPlay(play, s, -(e - s), n);
      // ANNAHME A-31: nach DELETE umfassen Start/Ende wieder das ganze Sample (sonst wäre der Bereich leer)
      return { channels: out, play: input.rangeIsChop ? p : clampPlayback({ ...p, start: 0, end: n, loopPoint: play.loopLock ? 0 : p.loopPoint }, n) };
    }
    case 'INSERT SILENCE': {
      const n = Math.round((params.silenceMs / 1000) * sr);
      const out = insertSilence(ch, s, n);
      // Startpunkt bleibt vor der Stille stehen (Handbuch: Stille „from the start point“)
      const shifted = shiftPlay(play, s, n, out[0]!.length);
      return { channels: out, play: { ...shifted, start: play.start, loopPoint: play.loopLock ? play.start : shifted.loopPoint } };
    }
    case 'SILENCE': return same(silence(ch, s, e));
    case 'EXTRACT': case 'COPY': {
      const out = kind === 'EXTRACT' ? discard(ch, s, e) : ch.map((c) => c.slice());
      const n = out[0]?.length ?? 0;
      return { channels: out, play: kind === 'COPY' ? play : clampPlayback({ ...play, start: 0, end: n, loopPoint: 0, chopOn: false, chops: [] }, n) };
    }
    case 'NORMALIZE': return same(normalize(ch, ...whole));
    case 'REVERSE': return same(reverse(ch, ...whole));
    case 'FADE IN': return same(fade(ch, s, e, 'in'));
    case 'FADE OUT': return same(fade(ch, s, e, 'out'));
    case 'STEREO>MONO': return same(stereoToMono(ch));
    case 'BIT CONVERT': return same(bitConvert(ch, params.bits, s, e));
    case 'RING MOD': return same(ringMod(ch, sr, { freq: params.ringFreq, wave: params.ringWave, mix: params.ringMix }, s, e));
    case 'COMBINE': {
      if (!params.other) return same(ch.map((c) => c.slice()));
      const out = combine(ch, sr, params.other.channels, params.other.sampleRate);
      const n = out[0]!.length;
      return { channels: out, play: clampPlayback({ ...play, end: play.end === len ? n : play.end }, n) };
    }
    case 'MIX': {
      if (!params.other) return same(ch.map((c) => c.slice()));
      const out = mix(ch, sr, params.other.channels, params.other.sampleRate, params.levelA, params.levelB);
      const n = out[0]!.length;
      return { channels: out, play: clampPlayback({ ...play, end: play.end === len ? n : play.end }, n) };
    }
  }
}
