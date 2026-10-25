import type { ButtonId, PadIndex } from './events';

/**
 * Tastatur-Belegung über KeyboardEvent.code (physische Taste) – damit gleich auf QWERTZ und QWERTY.
 * Pads als 4×4-Block, angeordnet wie die Pads selbst (Pad 1 links unten):
 *   1 2 3 4   → Pads 13–16
 *   Q W E R   → Pads  9–12
 *   A S D F   → Pads  5–8
 *   Z X C V   → Pads  1–4   (auf deutscher Tastatur: Y X C V)
 */
export const PAD_KEYS: Readonly<Record<string, PadIndex>> = {
  KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3,
  KeyA: 4, KeyS: 5, KeyD: 6, KeyF: 7,
  KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11,
  Digit1: 12, Digit2: 13, Digit3: 14, Digit4: 15,
};

export const BUTTON_KEYS: Readonly<Record<string, ButtonId>> = {
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  // Alternative für Mac-Tastaturen ohne bequeme F-Tasten:
  Digit7: 'F1', Digit8: 'F2', Digit9: 'F3', Digit0: 'F4', Minus: 'F5', Equal: 'F6',
  ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT',
  Tab: 'MODE',
  Escape: 'MAIN',
  Enter: 'WINDOW',
  Backspace: 'ERASE',
  KeyU: 'UNDO_SEQ',
  KeyT: 'TAP_TEMPO',
  KeyL: 'FULL_LEVEL',
  KeyK: 'LEVELS_16',
  KeyN: 'NEXT_SEQ',
  KeyM: 'TRACK_MUTE',
  KeyG: 'BANK_A', KeyH: 'BANK_B', KeyJ: 'BANK_C', Semicolon: 'BANK_D',
  ArrowUp: 'CURSOR_UP', ArrowDown: 'CURSOR_DOWN', ArrowLeft: 'CURSOR_LEFT', ArrowRight: 'CURSOR_RIGHT',
  Comma: 'STEP_PREV', Period: 'STEP_NEXT',
  BracketLeft: 'BAR_PREV', BracketRight: 'BAR_NEXT',
  KeyO: 'REC', KeyP: 'OVER_DUB',
  Space: 'PLAY', Backquote: 'STOP', KeyI: 'PLAY_START',
  KeyB: 'AFTER',
};

/** Data Wheel über Tastatur: +/− Schritt. */
export const WHEEL_KEYS: Readonly<Record<string, number>> = {
  NumpadAdd: 1, NumpadSubtract: -1, PageUp: 1, PageDown: -1,
};

export type KeyTarget =
  | { kind: 'pad'; pad: PadIndex }
  | { kind: 'button'; id: ButtonId }
  | { kind: 'wheel'; delta: number }
  | null;

export function keyTarget(code: string): KeyTarget {
  const pad = PAD_KEYS[code];
  if (pad !== undefined) return { kind: 'pad', pad };
  const id = BUTTON_KEYS[code];
  if (id !== undefined) return { kind: 'button', id };
  const delta = WHEEL_KEYS[code];
  if (delta !== undefined) return { kind: 'wheel', delta };
  return null;
}

/** Feste Velocity für Tastatur-Pads (keine Anschlagdynamik möglich). */
export const KEYBOARD_PAD_VELOCITY = 100;
