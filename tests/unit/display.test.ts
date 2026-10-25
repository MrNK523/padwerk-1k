import { describe, expect, it } from 'vitest';
import { FONT, GLYPH_H, GLYPH_W, glyph } from '../../src/ui/display/font5x7';
import { COLS, FrameBuffer, LCD_H, LCD_W, ROWS } from '../../src/ui/display/framebuffer';
import { drawSoftkeys } from '../../src/ui/screens/screen';

describe('Display', () => {
  it('hat 240×64 Punkte (MPC1000-Spezifikation) und ein 40×8-Zeichenraster', () => {
    expect([LCD_W, LCD_H]).toEqual([240, 64]);
    expect([COLS, ROWS]).toEqual([40, 8]);
  });

  it('Schrift deckt druckbares ASCII und Umlaute ab', () => {
    for (let c = 32; c < 127; c++) expect(FONT.has(String.fromCharCode(c)), `Zeichen ${c}`).toBe(true);
    for (const ch of 'ÄÖÜäöüß') expect(FONT.has(ch)).toBe(true);
  });

  it('jede Glyphe passt in 5×7', () => {
    for (const rows of FONT.values()) {
      expect(rows).toHaveLength(GLYPH_H);
      for (const r of rows) expect(r).toBeLessThan(1 << GLYPH_W);
    }
  });

  it('unbekannte Zeichen fallen auf „?“ zurück', () => {
    expect(glyph('€')).toBe(glyph('?'));
  });

  it('zeichnet Text pixelgenau', () => {
    const fb = new FrameBuffer();
    fb.text(0, 0, 'I');
    // „I“: .###. in Zeile 0, ..#.. in Zeile 1
    expect([0, 1, 2, 3, 4].map((x) => fb.get(x, 0))).toEqual([0, 1, 1, 1, 0]);
    expect([0, 1, 2, 3, 4].map((x) => fb.get(x, 1))).toEqual([0, 0, 1, 0, 0]);
  });

  it('ignoriert Zeichnen außerhalb des Displays', () => {
    const fb = new FrameBuffer();
    fb.set(-1, 0, true);
    fb.set(240, 63, true);
    fb.text(238, 60, 'WW');
    expect(fb.get(-1, 0)).toBe(0);
  });

  it('Softkeys belegen die unterste Zeile in 6 Feldern', () => {
    const fb = new FrameBuffer();
    drawSoftkeys(fb, ['F1', '', '', '', '', 'F6']);
    expect(fb.get(20, 63)).toBe(1); // Feld 1 gefüllt (Hintergrund)
    expect(fb.get(100, 60)).toBe(0); // Feld 3 leer
    expect(fb.get(220, 63)).toBe(1); // Feld 6 gefüllt
    expect(fb.get(20, 50)).toBe(0); // darüber bleibt frei
  });
});
