import { CELL_H, CELL_W, GLYPH_H, GLYPH_W, glyph } from './font5x7';

/** Display-Auflösung laut MPC1000-Spezifikation: 240 × 64 Punkte, monochrom. */
export const LCD_W = 240;
export const LCD_H = 64;
export const COLS = LCD_W / CELL_W; // 40
export const ROWS = LCD_H / CELL_H; // 8

/** 1-Bit-Bildspeicher (1 Byte pro Pixel, 0/1 – einfach und schnell genug für 15 360 Pixel). */
export class FrameBuffer {
  readonly pixels = new Uint8Array(LCD_W * LCD_H);
  /** Zähler, der bei jeder Änderung steigt – der Renderer zeichnet nur bei Änderung neu. */
  version = 0;

  clear(): void {
    this.pixels.fill(0);
    this.version++;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return 0;
    return this.pixels[y * LCD_W + x]!;
  }

  set(x: number, y: number, on: boolean | number): void {
    if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H) return;
    this.pixels[y * LCD_W + x] = on ? 1 : 0;
  }

  fillRect(x: number, y: number, w: number, h: number, on = true): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, on);
    this.version++;
  }

  invertRect(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, !this.get(xx, yy));
    this.version++;
  }

  hline(x: number, y: number, w: number, on = true): void {
    this.fillRect(x, y, w, 1, on);
  }

  vline(x: number, y: number, h: number, on = true): void {
    this.fillRect(x, y, 1, h, on);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.hline(x, y, w);
    this.hline(x, y + h - 1, w);
    this.vline(x, y, h);
    this.vline(x + w - 1, y, h);
  }

  /** Text in Pixelkoordinaten. `invert` zeichnet hell auf dunkel (Cursor/Hervorhebung). */
  text(x: number, y: number, s: string, invert = false): void {
    let cx = x;
    for (const ch of s) {
      const g = glyph(ch);
      if (invert) this.fillRect(cx, y, CELL_W, CELL_H, true);
      for (let row = 0; row < GLYPH_H; row++) {
        const bits = g[row]!;
        for (let col = 0; col < GLYPH_W; col++) {
          const on = (bits >> (GLYPH_W - 1 - col)) & 1;
          if (on) this.set(cx + col, y + row, !invert);
        }
      }
      cx += CELL_W;
    }
    this.version++;
  }

  /** Text im Zeichenraster (Spalte 0–39, Zeile 0–7). */
  textAt(col: number, row: number, s: string, invert = false): void {
    this.text(col * CELL_W, row * CELL_H, s, invert);
  }

  /** Text als ASCII-Kunst (für Tests und Debugging). */
  toAscii(): string {
    const lines: string[] = [];
    for (let y = 0; y < LCD_H; y++) {
      let line = '';
      for (let x = 0; x < LCD_W; x++) line += this.pixels[y * LCD_W + x] ? '#' : '.';
      lines.push(line);
    }
    return lines.join('\n');
  }
}
