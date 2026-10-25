import type { ButtonId, HwEvent } from '../../input/events';
import type { Levels16Settings } from '../../core/levels16';
import type { Store } from '../../state/store';
import { FrameBuffer, LCD_W } from '../display/framebuffer';
import { CELL_H, CELL_W } from '../display/font5x7';

/** Ein Modus/Bildschirm oder Fenster. Bekommt nur Hardware-Ereignisse und zeichnet in den Bildspeicher. */
export interface Screen {
  readonly id: string;
  /** Beschriftung der Softkeys F1–F6 (leer = ohne Funktion). */
  softkeys(): readonly string[];
  /** Index des hervorgehobenen Softkeys (aktive Seite) oder -1. */
  activeSoftkey?(): number;
  render(fb: FrameBuffer): void;
  /** true = Ereignis verarbeitet (bei Pads: kein Klang). */
  onEvent(e: HwEvent): boolean;
  onEnter?(): void;
}

/** Zustand der Bedienoberfläche, den mehrere Screens teilen. */
export interface UiState {
  bank: 0 | 1 | 2 | 3;
  fullLevel: boolean;
  fullLevelValue: number;
  levels16On: boolean;
  levels16: Levels16Settings;
  /** Zuletzt angeschlagenes Pad 0–63 (wie am Gerät: bestimmt das bearbeitete Pad) */
  selectedPad: number;
  lastVelocity: number | null;
  /** aktuell gehaltene Tasten (für Kombinationen wie SHIFT + F5) */
  held: Set<ButtonId>;
  message: string;
}

/** Was Screens von der App brauchen – bewusst schmal gehalten. */
export interface AppCtx {
  store: Store;
  ui: UiState;
  openWindow(w: Screen): void;
  closeWindow(): void;
  openFilePicker(): void;
  /** Kurzer Hinweis in der Statuszeile. */
  flash(text: string): void;
  /** SHIFT oder TAP TEMPO gehalten → zehnfache Wheel-Schritte */
  coarse(): boolean;
  playPadIndex(pad: number, velocity: number): void;
  stopPadIndex(pad: number): void;
  setLatencyMeasure?(): void;
}

/**
 * Softkey-Leiste in der untersten Zeile: 6 Felder à 40 Pixel.
 * Aktionstasten und die aktive Seite sind hell auf dunkel, inaktive Seiten nur beschriftet.
 */
export function drawSoftkeys(fb: FrameBuffer, labels: readonly string[], active = -2): void {
  const w = LCD_W / 6;
  const y = 56;
  fb.fillRect(0, y, LCD_W, 8, false);
  for (let i = 0; i < 6; i++) {
    const label = (labels[i] ?? '').slice(0, 6);
    const x = i * w;
    if (!label) continue;
    const tx = x + Math.floor((w - label.length * CELL_W) / 2) + 1;
    fb.text(tx, y + 1, label, false);
    const filled = active === -2 || active === i;
    if (filled) fb.invertRect(x + 1, y, w - 2, 8);
  }
}

/** Fensterrahmen mit Titelzeile; liefert die Innenkoordinaten. */
export function drawWindowFrame(fb: FrameBuffer, title: string, x = 6, y = 4, w = 228, h = 52): { x: number; y: number } {
  fb.fillRect(x - 1, y - 1, w + 2, h + 2, false);
  fb.rect(x, y, w, h);
  fb.rect(x + 1, y + 1, w - 2, h - 2);
  const tx = x + Math.floor((w - title.length * CELL_W) / 2);
  fb.hline(x, y + CELL_H + 2, w);
  fb.text(tx, y + 3, title);
  return { x: x + 4, y: y + CELL_H + 5 };
}

/** Text an Spalte/Zeile, wahlweise invertiert (Cursor). */
export function cell(fb: FrameBuffer, col: number, row: number, text: string, invert = false): void {
  fb.text(col * CELL_W, row * CELL_H, text, invert);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const pad3 = (n: number) => String(n).padStart(3, ' ');

/** Tune als „+12.50“ (Halbtöne.Cent). */
export function formatTune(semis: number): string {
  const sign = semis < 0 ? '-' : '+';
  const a = Math.abs(semis);
  let whole = Math.floor(a + 1e-9);
  let cents = Math.round((a - whole) * 100);
  if (cents === 100) { whole++; cents = 0; }
  return `${sign}${pad2(whole)}.${pad2(cents)}`;
}

/** Pan −50…50 als „L50“, „MID“, „R12“. */
export function formatPan(p: number): string {
  if (p === 0) return 'MID';
  return p < 0 ? `L${pad2(-p)}` : `R${pad2(p)}`;
}

/** Wheel-Änderung eines Zahlenwerts mit Grenzen. */
export function step(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}

/** Wheel-Änderung über eine Liste von Optionen (bleibt am Rand stehen). */
export function stepEnum<T>(options: readonly T[], value: T, delta: number): T {
  const i = Math.max(0, options.indexOf(value));
  return options[Math.min(options.length - 1, Math.max(0, i + Math.sign(delta)))]!;
}
