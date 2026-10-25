/** Nachrichten zwischen Hauptthread und AudioWorklet. */
import type { NoteVariation } from '../core/levels16';
import type { DrumProgram } from '../core/model';
import type { NoteEvent, Sequence, TimeSig } from '../core/sequence';
import type { RecMode, SeqSettings, TransportState } from '../core/sequencerCore';

export type TransportCmd =
  | { cmd: 'playStart'; fromBar1?: boolean }
  | { cmd: 'play' }
  | { cmd: 'stop' }
  | { cmd: 'record'; mode: 'rec' | 'dub'; fromStart: boolean }
  | { cmd: 'wait'; mode: 'rec' | 'dub' }
  | { cmd: 'punchIn'; mode: 'rec' | 'dub' }
  | { cmd: 'punchOut' }
  | { cmd: 'locate'; tick: number }
  | { cmd: 'fix' };

export type ToWorklet =
  | { type: 'sample'; id: string; sampleRate: number; channels: Float32Array[] }
  | { type: 'sampleRemove'; id: string }
  | { type: 'program'; program: DrumProgram }
  | { type: 'programRemove'; id: string }
  /** `live` = Anschlag vom Spieler (wird bei laufender Aufnahme aufgenommen) */
  | { type: 'padOn'; programId: string; pad: number; velocity: number; variation?: NoteVariation; live?: boolean }
  | { type: 'padOff'; programId: string; pad: number; live?: boolean }
  | { type: 'repeatOn'; programId: string; pad: number; velocity: number; variation?: NoteVariation }
  | { type: 'repeatOff'; pad: number }
  | { type: 'erasePads'; pads: number[] }
  | { type: 'sequence'; index: number; seq: Sequence }
  | { type: 'seqSettings'; settings: SeqSettings; activeTrack: number; soloTrack: number | null }
  | ({ type: 'transport' } & TransportCmd)
  | { type: 'allSoundOff' }
  | { type: 'measureStart'; threshold: number; timeoutFrames: number }
  | { type: 'statusRequest' };

export type FromWorklet =
  | { type: 'ready'; sampleRate: number }
  | { type: 'status'; activeVoices: number; frame: number }
  | { type: 'pos'; tick: number; state: TransportState; recMode: RecMode; seqIndex: number }
  | { type: 'track'; seqIndex: number; track: number; events: NoteEvent[]; used: boolean }
  | { type: 'bars'; seqIndex: number; bars: TimeSig[] }
  | { type: 'measureResult'; ok: true; latencyFrames: number; peak: number }
  | { type: 'measureResult'; ok: false; reason: 'timeout'; peak: number };

/** Pad A01–D16 = MIDI-Note 36–99 (fest, laut JJOS2XL-Handbuch). */
export const NOTE_BASE = 36;

export function padToNote(bank: 0 | 1 | 2 | 3, pad: number): number {
  return NOTE_BASE + bank * 16 + pad;
}

/** Physisches Pad 0–15 + Bank → Pad-Index 0–63 im Program. */
export function padIndex(bank: 0 | 1 | 2 | 3, pad: number): number {
  return bank * 16 + pad;
}

export const PROCESSOR_NAME = 'padwerk-engine';
