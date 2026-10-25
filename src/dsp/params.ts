/**
 * Umrechnung der Geräte-Parameter (meist 0–100) in physikalische Größen.
 * Die Handbücher nennen nur die Wertebereiche, keine Einheiten → alle Kurven sind Annahmen.
 */

/** ANNAHME A-04: Hüllkurvenzeiten quadratisch, Attack bis 3 s, Decay/Release bis 5 s. */
export const ATTACK_MAX_MS = 3000;
export const DECAY_MAX_MS = 5000;

export function attackMs(v: number): number {
  const x = Math.min(100, Math.max(0, v)) / 100;
  return ATTACK_MAX_MS * x * x;
}

export function decayMs(v: number): number {
  const x = Math.min(100, Math.max(0, v)) / 100;
  return DECAY_MAX_MS * x * x;
}

/**
 * VELO (JJOS2XL AMP): Velocity 1–127 wird auf den Pegel VELO…100 % abgebildet.
 * VELO 0 = volle Dynamik, VELO 100 = immer voller Pegel (Grafik im JJOS2XL-Handbuch).
 */
export function veloGain(velo: number, velocity: number): number {
  const v = Math.min(100, Math.max(0, velo));
  const vel = Math.min(127, Math.max(1, velocity));
  return (v + ((100 - v) * (vel - 1)) / 126) / 100;
}

/** ANNAHME A-11: Pegel 0–100 wirkt linear auf die Amplitude. */
export function levelGain(v: number): number {
  return Math.min(100, Math.max(0, v)) / 100;
}

/** ANNAHME A-09: Cutoff 0–100 exponentiell von 20 Hz bis 20 kHz. */
export function cutoffHz(v: number): number {
  const x = Math.min(100, Math.max(0, v)) / 100;
  return 20 * Math.pow(1000, x);
}

/** ANNAHME A-09: Resonanz 0–100 → Güte 0,707 … ~14,7. */
export function resoToQ(v: number): number {
  const x = Math.min(100, Math.max(0, v)) / 100;
  return 0.707 + x * x * 14;
}

/** ANNAHME A-09: EQL/EQH: −100…+100 → ±12 dB, feste Eckfrequenzen. */
export const EQ_LOW_HZ = 250;
export const EQ_HIGH_HZ = 5000;
export function eqGain(v: number): number {
  const db = (Math.min(100, Math.max(-100, v)) / 100) * 12;
  return Math.pow(10, db / 20);
}

/**
 * Panorama −50 (L50) … +50 (R50). Mitte = beide Kanäle voll (Pan-Gesetz mit +3 dB Ausgleich,
 * begrenzt auf 1), damit ein mittiges Pad genauso laut ist wie ohne Pan.
 */
export function panGains(pan: number): [number, number] {
  const p = (Math.min(50, Math.max(-50, pan)) + 50) / 100;
  const a = (p * Math.PI) / 2;
  return [Math.min(1, Math.SQRT2 * Math.cos(a)), Math.min(1, Math.SQRT2 * Math.sin(a))];
}

/** Pan von Pad und Track werden addiert (JJOS2XL: L50 + R50 = MID). */
export function combinePan(a: number, b: number): number {
  return Math.min(50, Math.max(-50, a + b));
}

/** Tonhöhe in Halbtönen → Abspielrate. */
export function semitonesToRatio(semis: number): number {
  return Math.pow(2, semis / 12);
}
