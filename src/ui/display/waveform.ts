/**
 * Wellenform im 1-Bit-Display: pro Pixelspalte Minimum/Maximum des sichtbaren Ausschnitts.
 * Innerhalb des gewählten Bereichs durchgezogen, außerhalb punktiert (MPC1000-Handbuch:
 * „the parts set by start/end points highlighted“). Rein – nur Bildspeicher.
 */
import type { FrameBuffer } from './framebuffer';

export interface WaveArea { x: number; y: number; w: number; h: number }
export interface WaveView { from: number; to: number }
export interface WaveMarker { pos: number; style: 'solid' | 'dash' }

export interface WaveOptions {
  /** Pegel-Zoom (1, 2, 4, 8 …) */
  gain?: number;
  /** hervorgehobener Bereich [start, end) */
  sel?: [number, number];
  markers?: WaveMarker[];
  /** dieser Bereich wird invertiert (Blinken beim Vorhören) */
  flash?: [number, number] | null;
}

/** Sichtbarer Ausschnitt: Zoomstufe z halbiert die sichtbare Länge, zentriert um `center`. */
export function viewAround(center: number, frames: number, zoom: number, minVisible = 60): WaveView {
  const visible = Math.max(Math.min(frames, minVisible), frames / Math.pow(2, zoom));
  let from = Math.round(center - visible / 2);
  from = Math.max(0, Math.min(Math.max(0, frames - visible), from));
  return { from, to: Math.round(from + visible) };
}

/** Größte sinnvolle Zoomstufe (etwa 4 Pixel pro Sample-Punkt). */
export function maxZoom(frames: number, width: number): number {
  return Math.max(0, Math.ceil(Math.log2(Math.max(1, frames / Math.max(1, width / 4)))));
}

export function frameToX(pos: number, area: WaveArea, view: WaveView): number {
  return area.x + Math.floor(((pos - view.from) / Math.max(1, view.to - view.from)) * area.w);
}

export function drawWave(fb: FrameBuffer, c: Float32Array, area: WaveArea, view: WaveView, opts: WaveOptions = {}): void {
  const { x, y, w, h } = area;
  fb.fillRect(x, y, w, h, false);
  const mid = y + Math.floor(h / 2);
  const half = (h - 1) / 2;
  const gain = opts.gain ?? 1;
  const span = Math.max(1, view.to - view.from);
  const spp = span / w;
  let prev: number | null = null;
  for (let px = 0; px < w; px++) {
    const a = view.from + px * spp;
    const b = Math.max(a + 1, view.from + (px + 1) * spp);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = Math.floor(a); i < Math.ceil(b) && i < c.length; i++) {
      if (i < 0) continue;
      const v = c[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo === Infinity) { prev = null; continue; }
    // Stark vergrößert: Linie zum Wert der vorigen Spalte ziehen, damit die Kurve geschlossen bleibt
    const last = c[Math.min(c.length - 1, Math.ceil(b) - 1)]!;
    if (prev !== null && spp < 2) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
    prev = last;
    const top = Math.max(y, Math.round(mid - Math.min(1, hi * gain) * half));
    const bot = Math.min(y + h - 1, Math.round(mid - Math.max(-1, lo * gain) * half));
    const inSel = !opts.sel || (a >= opts.sel[0] && a < opts.sel[1]);
    for (let yy = top; yy <= bot; yy++) {
      if (inSel || (yy + px) % 2 === 0) fb.set(x + px, yy, true);
    }
    if (!inSel && px % 2 === 0) fb.set(x + px, mid, true); // Nulllinie außerhalb punktiert
  }
  for (const m of opts.markers ?? []) {
    const mx = frameToX(m.pos, area, view);
    if (mx < x || mx >= x + w) continue;
    for (let yy = y; yy < y + h; yy++) if (m.style === 'solid' || yy % 3 !== 2) fb.set(mx, yy, true);
  }
  if (opts.flash) {
    const fx0 = Math.max(x, frameToX(opts.flash[0], area, view));
    const fx1 = Math.min(x + w, frameToX(opts.flash[1], area, view));
    if (fx1 > fx0) fb.invertRect(fx0, y, fx1 - fx0, h);
  }
}
