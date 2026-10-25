/** Nachrichten zwischen Hauptthread und AudioWorklet. */

export type ToWorklet =
  | { type: 'padOn'; note: number; velocity: number }
  | { type: 'padOff'; note: number }
  | { type: 'allSoundOff' }
  | { type: 'measureStart'; threshold: number; timeoutFrames: number }
  | { type: 'statusRequest' };

export type FromWorklet =
  | { type: 'ready'; sampleRate: number }
  | { type: 'status'; activeVoices: number; frame: number }
  | { type: 'measureResult'; ok: true; latencyFrames: number; peak: number }
  | { type: 'measureResult'; ok: false; reason: 'timeout'; peak: number };

/** Pad A01–D16 = MIDI-Note 36–99 (fest, laut JJOS2XL-Handbuch). */
export const NOTE_BASE = 36;

export function padToNote(bank: 0 | 1 | 2 | 3, pad: number): number {
  return NOTE_BASE + bank * 16 + pad;
}

export const PROCESSOR_NAME = 'padwerk-engine';
