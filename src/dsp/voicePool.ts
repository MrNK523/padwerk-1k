/**
 * Stimmenverwaltung – rein, ohne Audio-API, damit testbar.
 * Original: 32 Stimmen (MPC1000 Spezifikation „Polyphony 32“).
 * ANNAHME A-05: Bei Überlauf wird die am längsten klingende Stimme gestohlen.
 */

export const MAX_VOICES = 32;

export interface VoiceSlot {
  active: boolean;
  /** Frame, an dem die Stimme gestartet wurde (für Stealing nach Alter). */
  startFrame: number;
}

export function createSlots(count = MAX_VOICES): VoiceSlot[] {
  return Array.from({ length: count }, () => ({ active: false, startFrame: 0 }));
}

/**
 * Liefert den Index der zu nutzenden Stimme.
 * `stolen` ist true, wenn eine klingende Stimme ersetzt wird (dann kurzer Fade nötig).
 */
export function allocateVoice(slots: readonly VoiceSlot[]): { index: number; stolen: boolean } {
  let oldest = 0;
  let oldestFrame = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (!s.active) return { index: i, stolen: false };
    if (s.startFrame < oldestFrame) {
      oldestFrame = s.startFrame;
      oldest = i;
    }
  }
  return { index: oldest, stolen: true };
}

export function countActive(slots: readonly VoiceSlot[]): number {
  let n = 0;
  for (const s of slots) if (s.active) n++;
  return n;
}
