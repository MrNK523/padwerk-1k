import { FrameBuffer, LCD_H, LCD_W } from './framebuffer';

export interface LcdTheme {
  /** Hintergrund (Pixel aus). */
  off: string;
  /** Pixel an. */
  on: string;
  /** Leichter Schatten der ausgeschalteten Pixel (LCD-Charakter). */
  ghost: string;
}

/** Eigene Farbwelt: warmes Bernstein-LCD (bewusst nicht die Farbe des Originals). */
export const AMBER_LCD: LcdTheme = {
  off: '#e9a23b',
  on: '#2a1606',
  ghost: '#dd9632',
};

/**
 * Zeichnet den 1-Bit-Bildspeicher ganzzahlig skaliert auf ein Canvas.
 * Jedes LCD-Pixel bekommt eine kleine Fuge – so entsteht das sichtbare Punktraster.
 */
export class LcdRenderer {
  private ctx: CanvasRenderingContext2D;
  private lastVersion = -1;
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement, private fb: FrameBuffer, private theme: LcdTheme = AMBER_LCD) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
    this.resize();
  }

  /** Größte ganzzahlige Skalierung, die in die CSS-Breite des Canvas passt. */
  resize(): void {
    const dpr = globalThis.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || LCD_W * 3;
    this.scale = Math.max(1, Math.floor((cssW * dpr) / LCD_W));
    this.canvas.width = LCD_W * this.scale;
    this.canvas.height = LCD_H * this.scale;
    this.lastVersion = -1;
  }

  render(force = false): void {
    if (!force && this.fb.version === this.lastVersion) return;
    this.lastVersion = this.fb.version;
    const { ctx, scale: s, theme } = this;
    // Fuge erst ab 5-facher Skalierung – darunter wirken invertierte Flächen sonst gestreift.
    const gap = s >= 5 ? 1 : 0;
    ctx.fillStyle = theme.off;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (gap) {
      ctx.fillStyle = theme.ghost;
      for (let y = 0; y < LCD_H; y++) for (let x = 0; x < LCD_W; x++) ctx.fillRect(x * s, y * s, s - gap, s - gap);
    }
    ctx.fillStyle = theme.on;
    const px = this.fb.pixels;
    for (let y = 0; y < LCD_H; y++) {
      for (let x = 0; x < LCD_W; x++) {
        if (px[y * LCD_W + x]) ctx.fillRect(x * s, y * s, s - gap, s - gap);
      }
    }
  }

  /** Canvas-Koordinate → LCD-Pixel (für Touch-Abkürzungen auf dem Display). */
  toLcd(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor(((clientX - r.left) / r.width) * LCD_W),
      y: Math.floor(((clientY - r.top) / r.height) * LCD_H),
    };
  }
}
