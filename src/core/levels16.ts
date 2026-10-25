/**
 * 16 Levels: ein Sound auf allen 16 Pads, jedes Pad mit anderem Parameterwert.
 * Typen laut MPC1000-Handbuch: VELOCITY, TUNE, FILTER, LAYER, DECAY, ATTACK.
 * Die konkreten Stufenwerte nennt das Handbuch nicht → ANNAHME A-08.
 */

export type Levels16Type = 'VELOCITY' | 'TUNE' | 'FILTER' | 'LAYER' | 'DECAY' | 'ATTACK';
export const LEVELS16_TYPES: readonly Levels16Type[] = ['VELOCITY', 'TUNE', 'FILTER', 'LAYER', 'DECAY', 'ATTACK'];

export interface Levels16Settings {
  type: Levels16Type;
  /** Quell-Pad 0–63, dessen Sound auf alle Pads gelegt wird */
  sourcePad: number;
  /** Nur bei TUNE: physisches Pad 0–15, das den Originalton spielt */
  originalKeyPad: number;
}

/** Abweichung vom Programmwert, die mit dem Anschlag mitgeht („Note Variation“). */
export interface NoteVariation {
  /** ersetzt die Velocity (VELOCITY) */
  velocity?: number;
  /** Halbtöne zusätzlich (TUNE) */
  tune?: number;
  /** ersetzt die Filterfrequenz 0–100 (FILTER) */
  filterFreq?: number;
  /** ersetzt Attack bzw. Decay 0–100 */
  attack?: number;
  decay?: number;
  /** Velocity nur für die Layer-Auswahl (LAYER) */
  layerVelocity?: number;
}

/** Stufe 0–15 → gleichmäßig verteilter Wert. ANNAHME A-08. */
const step127 = (i: number) => Math.round((127 * (i + 1)) / 16); // 8 … 127
const step100 = (i: number) => Math.round((100 * i) / 15); // 0 … 100

export function levels16Variation(s: Levels16Settings, physicalPad: number): NoteVariation {
  const i = Math.min(15, Math.max(0, physicalPad));
  switch (s.type) {
    case 'VELOCITY': return { velocity: step127(i) };
    case 'TUNE': return { tune: i - s.originalKeyPad };
    case 'FILTER': return { filterFreq: step100(i) };
    case 'LAYER': return { layerVelocity: step127(i) };
    case 'DECAY': return { decay: step100(i) };
    case 'ATTACK': return { attack: step100(i) };
  }
}
