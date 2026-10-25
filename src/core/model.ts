/**
 * Datenmodell für Programs, Pads und Samples – rein, serialisierbar, ohne Browser-API.
 * Parameter und Bereiche folgen dem JJOS2XL-Handbuch (Global Program Edit, Typ DRUM).
 */

export const PADS_PER_PROGRAM = 64; // A01–D16
export const LAYERS_PER_PAD = 3; // JJOS2XL: Layer 4 des Original-OS entfällt
export const MAX_PROGRAMS = 128; // ANNAHME A-10: kein dokumentiertes Limit, großzügig gewählt
export const SAMPLE_NAME_MAX = 16;

export type PlayMode = 'ONE_SHOT' | 'NOTE_ON';
export type VoiceOverlap = 'POLY' | 'MONO';
export type Direction = 'FOR' | 'REV';
export type SoundMode = 'L+R' | 'L' | 'R' | 'ST';
export type FilterType = 'OFF' | 'LPF' | 'BPF' | 'HPF' | 'EQL' | 'EQH';
export type MuteMode = 'MUTE' | 'SIMULT1' | 'SIMULT2';

export type LoopMode = 'FWD' | 'ALT' | 'XFADE';
export const MAX_CHOPS = 32; // JJOS2XL: Chop1–Chop32 (nicht-destruktiv)
export const MAX_REGIONS = 64; // JJOS2XL: destruktives Teilen bis 64 Regionen

export interface Region { start: number; end: number }

/** Wiedergabe-Einstellungen eines Samples (TRIM-Modus); Positionen in Sample-Frames. */
export interface SamplePlayback {
  start: number;
  end: number;
  loopOn: boolean;
  loopPoint: number;
  loopMode: LoopMode;
  /** Loop-Punkt folgt dem Startpunkt (Schloss-Symbol im JJOS2XL-Loop-Feld) */
  loopLock: boolean;
  /** Non-Destructive Chop (JJOS2XL) an/aus */
  chopOn: boolean;
  /** bis zu 32 Chops; Pads A01–B16 entsprechen Chop1–Chop32 */
  chops: Region[];
}

export interface SampleMeta extends SamplePlayback {
  id: string;
  name: string;
  sampleRate: number;
  channels: 1 | 2;
  frames: number;
  /** Grundton des Samples (MIDI-Note); JJOS2XL-Standard C_3 = 60. */
  rootNote: number;
}

export function defaultPlayback(frames: number): SamplePlayback {
  return { start: 0, end: frames, loopOn: false, loopPoint: 0, loopMode: 'FWD', loopLock: false, chopOn: false, chops: [] };
}

/** Gleichmäßige Chops zwischen start und end (JJOS2XL: beim Einschalten 32 gleiche Teile). */
export function equalChops(start: number, end: number, count = MAX_CHOPS): Region[] {
  const n = Math.max(1, Math.min(MAX_CHOPS, Math.round(count)));
  const len = end - start;
  return Array.from({ length: n }, (_, i) => ({ start: Math.round(start + (len * i) / n), end: Math.round(start + (len * (i + 1)) / n) }));
}

/** Wiedergabe-Werte an eine neue Länge anpassen (nach destruktiver Bearbeitung). */
export function clampPlayback(p: SamplePlayback, frames: number): SamplePlayback {
  const c = (v: number) => Math.max(0, Math.min(frames, Math.round(v)));
  const start = c(p.start);
  const end = Math.max(start, c(p.end));
  return {
    ...p, start, end, loopPoint: Math.min(end, Math.max(start, c(p.loopPoint))),
    chops: p.chops.map((r) => ({ start: c(r.start), end: Math.max(c(r.start), c(r.end)) })),
  };
}

export interface Layer {
  sampleId: string | null;
  /** 0–100 */
  level: number;
  /** Halbtöne mit Cent als Nachkommastellen, ±36 (= ±3 Oktaven). */
  tune: number;
  dir: Direction;
  /** Stereo-Sample als Mono abspielen (L, R, L+R) oder stereo (ST). */
  sound: SoundMode;
  /** Velocity-Bereich, in dem der Layer klingt (0–127). */
  rangeLo: number;
  rangeHi: number;
  /** Chop-Nummer 1–32 bei Sample mit Chop ON; 0 = ganzes Sample (Start/Ende aus TRIM) */
  chop: number;
}

export interface Envelope {
  /** alle 0–100 */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface PadParams {
  layers: [Layer, Layer, Layer];
  // AMP
  playMode: PlayMode;
  voice: VoiceOverlap;
  /** VELO 0–100: Untergrenze des Pegels bei Velocity 1 (100 = immer voller Pegel). */
  velo: number;
  amp: Envelope;
  // FILTER (Filter 1)
  filterType: FilterType;
  /** 0–100; bei EQL/EQH Verstärkung −100…+100 */
  filterFreq: number;
  filterReso: number;
  filterEnv: Envelope;
  /** ADSR-Tiefe auf den Filter 0–100 */
  filterDepth: number;
  /** Velocity → zusätzliche Filter-Tiefe 0–100 */
  filterVelo: number;
  // MUTE / SIMULT
  muteMode: MuteMode;
  /** Bis zu 4 Ziel-Pads (0–63) oder null. */
  targets: [number | null, number | null, number | null, number | null];
  /** Mute-Gruppe 0 = aus, 1–32 */
  muteGroup: number;
  // OUT
  /** Mixer-Pegel 0–100 */
  mixLevel: number;
  /** −50 (L50) … 0 (MID) … +50 (R50) */
  pan: number;
}

export interface DrumProgram {
  id: string;
  type: 'DRUM';
  name: string;
  pads: PadParams[];
}

export const emptyLayer = (rangeLo = 0, rangeHi = 127): Layer => ({
  sampleId: null, level: 100, tune: 0, dir: 'FOR', sound: 'ST', rangeLo, rangeHi, chop: 0,
});

export function defaultPad(): PadParams {
  return {
    layers: [emptyLayer(), emptyLayer(), emptyLayer()],
    playMode: 'ONE_SHOT',
    voice: 'POLY',
    velo: 0,
    // ANNAHME A-04: Standard-Hüllkurve „sofort an, voll halten“, kurzer Release
    amp: { attack: 0, decay: 0, sustain: 100, release: 0 },
    filterType: 'OFF',
    filterFreq: 100,
    filterReso: 0,
    filterEnv: { attack: 0, decay: 0, sustain: 100, release: 0 },
    filterDepth: 0,
    filterVelo: 0,
    muteMode: 'MUTE',
    targets: [null, null, null, null],
    muteGroup: 0,
    mixLevel: 100,
    pan: 0,
  };
}

export function newDrumProgram(id: string, name: string): DrumProgram {
  return { id, type: 'DRUM', name, pads: Array.from({ length: PADS_PER_PROGRAM }, defaultPad) };
}

/** Pad-Index 0–63 → „A01“…„D16“ */
export function padName(index: number): string {
  const bank = 'ABCD'[Math.floor(index / 16)] ?? '?';
  return `${bank}${String((index % 16) + 1).padStart(2, '0')}`;
}

/** MIDI-Note 36–99 ↔ Pad-Index 0–63 (fest, laut JJOS2XL). */
export const noteToPad = (note: number): number => note - 36;
export const padToNoteIndex = (pad: number): number => pad + 36;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Sample-Namen wie am Gerät: max. 16 Zeichen, nur druckbare Zeichen. */
export function sanitizeName(raw: string): string {
  const base = raw.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[^\x20-\x7EÄÖÜäöüß]/g, '_').trim();
  return (base || 'Sample').slice(0, SAMPLE_NAME_MAX);
}

/** Eindeutiger Name: hängt bei Kollision eine Nummer an (Sample01 → Sample02 …). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i).padStart(2, '0');
    const candidate = name.slice(0, SAMPLE_NAME_MAX - suffix.length) + suffix;
    if (!set.has(candidate)) return candidate;
  }
  return name;
}
