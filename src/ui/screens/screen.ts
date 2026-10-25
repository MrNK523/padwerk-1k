import type { HwEvent } from '../../input/events';
import { FrameBuffer, LCD_W } from '../display/framebuffer';

/** Ein Modus/Bildschirm. Bekommt nur Hardware-Ereignisse und zeichnet in den Bildspeicher. */
export interface Screen {
  readonly id: string;
  /** Beschriftung der Softkeys F1–F6 (leer = ohne Funktion). */
  softkeys(): readonly string[];
  render(fb: FrameBuffer): void;
  /** true = Ereignis verarbeitet. */
  onEvent(e: HwEvent): boolean;
}

/** Softkey-Leiste in der untersten Zeile: 6 Felder à 40 Pixel. */
export function drawSoftkeys(fb: FrameBuffer, labels: readonly string[]): void {
  const w = LCD_W / 6;
  const y = 56;
  for (let i = 0; i < 6; i++) {
    const label = (labels[i] ?? '').slice(0, 6);
    if (!label) continue;
    const x = i * w;
    fb.fillRect(x + 1, y, w - 2, 8, false);
    const tx = x + Math.floor((w - label.length * 6) / 2) + 1;
    fb.text(tx, y + 1, label, false);
    // Text hell auf dunklem Feld: Bereich invertieren
    fb.invertRect(x + 1, y, w - 2, 8);
  }
}
