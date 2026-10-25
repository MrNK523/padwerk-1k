/**
 * Hardware-Ereignisse: die einzige Sprache, die Modi/Screens verstehen.
 * Touch, Maus, Tastatur, später MIDI und Fußschalter werden in diese Ereignisse übersetzt.
 */

export const BUTTON_IDS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'SHIFT', 'MODE', 'MAIN', 'WINDOW', 'UNDO_SEQ', 'ERASE', 'NUMERIC',
  'TAP_TEMPO', 'FULL_LEVEL', 'LEVELS_16', 'NEXT_SEQ', 'TRACK_MUTE',
  'BANK_A', 'BANK_B', 'BANK_C', 'BANK_D',
  'CURSOR_UP', 'CURSOR_DOWN', 'CURSOR_LEFT', 'CURSOR_RIGHT',
  'STEP_PREV', 'STEP_NEXT', 'BAR_PREV', 'BAR_NEXT',
  'REC', 'OVER_DUB', 'STOP', 'PLAY', 'PLAY_START',
  'AFTER',
] as const;

export type ButtonId = (typeof BUTTON_IDS)[number];

/** Physische Pad-Position 0–15 (0 = links unten, 15 = rechts oben – wie bei Pad-Samplern üblich). */
export type PadIndex = number;

export type HwEvent =
  | { kind: 'button'; id: ButtonId; down: boolean; source: InputSource }
  | { kind: 'pad'; pad: PadIndex; down: boolean; velocity: number; source: InputSource }
  | { kind: 'wheel'; delta: number; source: InputSource }
  | { kind: 'slider'; slider: 0 | 1; value: number; source: InputSource };

export type InputSource = 'touch' | 'mouse' | 'keyboard' | 'midi' | 'footswitch' | 'test';

export type HwListener = (e: HwEvent) => void;

/** Minimaler synchroner Event-Bus. Reihenfolge der Listener = Reihenfolge der Registrierung. */
export class HwBus {
  private listeners = new Set<HwListener>();

  on(fn: HwListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: HwEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
