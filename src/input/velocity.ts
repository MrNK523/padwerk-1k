/**
 * Velocity aus der Tap-Position im Pad.
 * ANNAHME A-07: oben im Pad = laut (127), unten = leise (VELOCITY_MIN). Linearer Verlauf.
 * Das Original misst Anschlagdruck; Touchscreens liefern dafür keine verlässlichen Werte.
 */

export const VELOCITY_MIN = 16;
export const VELOCITY_MAX = 127;

/** @param yNorm 0 = Oberkante des Pads, 1 = Unterkante. Werte außerhalb werden begrenzt. */
export function velocityFromPosition(yNorm: number): number {
  const y = Number.isFinite(yNorm) ? Math.min(1, Math.max(0, yNorm)) : 0;
  return Math.round(VELOCITY_MAX - y * (VELOCITY_MAX - VELOCITY_MIN));
}

/** Full Level: Original spielt dann immer mit 127 (JJOS2XL: Wert einstellbar). */
export function applyFullLevel(velocity: number, fullLevel: boolean, fullLevelValue = 127): number {
  return fullLevel ? fullLevelValue : velocity;
}
