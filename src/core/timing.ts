/**
 * Timing Correct, Swing, Stärke – rein.
 * Notenwerte laut MPC1000-Handbuch: 1/8, 1/8(3), 1/16, 1/16(3), 1/32, 1/32(3), OFF.
 * Rasterweiten in Ticks laut JJOS2XL-Handbuch (Grid Edit): 48, 32, 24, 16, 12, 8, 1.
 */
import { PPQ } from './sequence';

export type TcValue = '1/8' | '1/8-3' | '1/16' | '1/16-3' | '1/32' | '1/32-3' | 'OFF';
export const TC_VALUES: readonly TcValue[] = ['1/8', '1/8-3', '1/16', '1/16-3', '1/32', '1/32-3', 'OFF'];

export function gridTicks(tc: TcValue): number {
  switch (tc) {
    case '1/8': return PPQ / 2; // 48
    case '1/8-3': return PPQ / 3; // 32
    case '1/16': return PPQ / 4; // 24
    case '1/16-3': return PPQ / 6; // 16
    case '1/32': return PPQ / 8; // 12
    case '1/32-3': return PPQ / 12; // 8
    case 'OFF': return 1;
  }
}

export const SWING_MIN = 50;
/** ANNAHME A-01: Swing-Bereich 50–75 %. */
export const SWING_MAX = 75;

export function isTriplet(tc: TcValue): boolean {
  return tc.endsWith('-3');
}

/**
 * Verschiebung des n-ten Rasterschritts durch Swing.
 * ANNAHME A-02: Jeder zweite Schritt (die „geraden Events“ laut Handbuch) liegt bei
 * 2 · Raster · Swing% statt bei 1 · Raster; 50 % = gerade, 66,7 % = Triolengefühl.
 * Bei Triolen-Rastern und OFF wirkt Swing nicht (ANNAHME A-02).
 */
export function swingOffset(stepIndex: number, tc: TcValue, swing: number): number {
  if (tc === 'OFF' || isTriplet(tc) || stepIndex % 2 === 0) return 0;
  const g = gridTicks(tc);
  const s = Math.min(SWING_MAX, Math.max(SWING_MIN, swing)) / 100;
  return Math.round(2 * g * s - g);
}

/** Tick des Rasterschritts n inklusive Swing. */
export function gridPosition(stepIndex: number, tc: TcValue, swing: number): number {
  return stepIndex * gridTicks(tc) + swingOffset(stepIndex, tc, swing);
}

/**
 * Timing Correct eines Ticks: nächster Rasterschritt (mit Swing), dann um `strength` % dorthin bewegt.
 * JJOS2XL: Strength 0 % = unverändert, 100 % = genau auf dem Raster.
 * `origin` = Tick, ab dem das Raster zählt (Takt- bzw. Sequenzanfang).
 */
export function timingCorrect(tick: number, tc: TcValue, swing: number, strength = 100, origin = 0): number {
  if (tc === 'OFF') return Math.round(tick);
  const g = gridTicks(tc);
  const rel = tick - origin;
  const n = Math.round(rel / g);
  // Nachbarn prüfen, weil Swing den nächsten Schritt verschieben kann
  let best = gridPosition(n, tc, swing);
  for (const k of [n - 1, n + 1]) {
    const p = gridPosition(k, tc, swing);
    if (Math.abs(p - rel) < Math.abs(best - rel)) best = p;
  }
  const s = Math.min(100, Math.max(0, strength)) / 100;
  return Math.round(origin + rel + (best - rel) * s);
}

/** Nächster Rasterschritt (Index) ab einem Tick – für Note Repeat. */
export function nextStepAtOrAfter(tick: number, tc: TcValue, swing: number, origin = 0): { index: number; tick: number } {
  const g = gridTicks(tc);
  let n = Math.floor((tick - origin) / g) - 1;
  while (origin + gridPosition(n, tc, swing) < tick - 1e-9) n++;
  return { index: n, tick: origin + gridPosition(n, tc, swing) };
}
