/**
 * Start-Kit: alle Klänge werden zur Laufzeit per Code erzeugt (keine fremden Samples).
 * Deterministisch (fester Zufalls-Seed), damit Tests und Projekte reproduzierbar sind.
 */

export const KIT_RATE = 44100;

export interface KitSound {
  name: string;
  data: Float32Array;
}

/** Kleiner, schneller Zufallsgenerator (mulberry32) – reproduzierbar. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = Math.PI * 2;
const sec = (s: number) => Math.round(s * KIT_RATE);

function normalize(buf: Float32Array, peak = 0.89): Float32Array {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i]! *= peak / max;
  return buf;
}

/** Ein-Pol-Hochpass/Tiefpass für Rauschen. */
function onePole(cutHz: number) {
  const a = Math.exp((-TWO_PI * cutHz) / KIT_RATE);
  let lp = 0;
  return { lp: (x: number) => (lp = (1 - a) * x + a * lp), hp: (x: number) => x - (lp = (1 - a) * x + a * lp) };
}

/** Bandpass zweiter Ordnung (Biquad, RBJ-Formeln) für Rauschen und Metallklänge. */
function bandpass(f: number, q: number) {
  const w = (TWO_PI * f) / KIT_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function kick(len: number, f0: number, f1: number, sweep: number, decay: number, click: number): Float32Array {
  const out = new Float32Array(sec(len));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    const f = f1 + (f0 - f1) * Math.exp(-t / sweep);
    ph += (TWO_PI * f) / KIT_RATE;
    const env = Math.exp(-t / decay);
    const clk = click * Math.exp(-t / 0.002) * (i % 2 ? 1 : -1);
    out[i] = Math.tanh(1.4 * Math.sin(ph) * env) + clk;
  }
  return normalize(out);
}

function snare(len: number, tone: number, toneDecay: number, noiseDecay: number, bright: number, seed: number): Float32Array {
  const out = new Float32Array(sec(len));
  const r = rng(seed);
  const hp = onePole(bright);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    ph += (TWO_PI * tone * (1 + 0.5 * Math.exp(-t / 0.01))) / KIT_RATE;
    const body = Math.sin(ph) * Math.exp(-t / toneDecay) * 0.6;
    const noise = hp.hp(r() * 2 - 1) * Math.exp(-t / noiseDecay);
    out[i] = body + noise;
  }
  return normalize(out);
}

function clap(seed: number): Float32Array {
  const out = new Float32Array(sec(0.45));
  const r = rng(seed);
  const bp = bandpass(1200, 0.9);
  const bursts = [0, 0.011, 0.022, 0.034];
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    let env = 0;
    for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) / (b === 0.034 ? 0.12 : 0.008)));
    out[i] = bp(r() * 2 - 1) * env;
  }
  return normalize(out);
}

/** Metallisches Gemisch aus sechs Rechteck-Oszillatoren, bandpassgefiltert (Hi-Hat/Becken). */
function metal(len: number, decay: number, bpHz: number, seed: number, choke = 0): Float32Array {
  const out = new Float32Array(sec(len));
  const freqs = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
  const phases = freqs.map(() => 0);
  const bp = bandpass(bpHz, 0.7);
  const hp = onePole(6000);
  const r = rng(seed);
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      phases[k]! += freqs[k]! / KIT_RATE;
      s += phases[k]! % 1 < 0.5 ? 1 : -1;
    }
    s = s / 6 + (r() * 2 - 1) * 0.3;
    let env = Math.exp(-t / decay);
    if (choke > 0 && t > choke) env *= Math.exp(-(t - choke) / 0.01);
    out[i] = hp.hp(bp(s)) * env;
  }
  return normalize(out, 0.8);
}

function tom(f: number, len: number): Float32Array {
  const out = new Float32Array(sec(len));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    ph += (TWO_PI * f * (1 + 0.35 * Math.exp(-t / 0.04))) / KIT_RATE;
    out[i] = Math.sin(ph) * Math.exp(-t / (len / 3.2));
  }
  return normalize(out);
}

function rim(): Float32Array {
  const out = new Float32Array(sec(0.12));
  const bp = bandpass(1800, 6);
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    const x = i < 40 ? (i % 2 ? 1 : -1) : 0;
    out[i] = bp(x) * 4 + Math.sin(TWO_PI * 480 * t) * Math.exp(-t / 0.012) * 0.6;
  }
  return normalize(out);
}

function cowbell(): Float32Array {
  const out = new Float32Array(sec(0.5));
  const bp = bandpass(700, 2);
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    const s = ((t * 540) % 1 < 0.5 ? 1 : -1) + ((t * 800) % 1 < 0.5 ? 1 : -1);
    out[i] = bp(s) * (0.7 * Math.exp(-t / 0.03) + 0.3 * Math.exp(-t / 0.18));
  }
  return normalize(out);
}

function shaker(seed: number): Float32Array {
  const out = new Float32Array(sec(0.16));
  const r = rng(seed);
  const bp = bandpass(7000, 1.2);
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.05);
    out[i] = bp(r() * 2 - 1) * env;
  }
  return normalize(out, 0.7);
}

function bass808(): Float32Array {
  const out = new Float32Array(sec(1.6));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    ph += (TWO_PI * (55 + 30 * Math.exp(-t / 0.03))) / KIT_RATE;
    out[i] = Math.tanh(1.8 * Math.sin(ph)) * Math.exp(-t / 0.7);
  }
  return normalize(out);
}

/** Moll-Akkord aus Sägezähnen mit abklingendem Tiefpass – für melodische Tests (Grundton C3). */
function stab(): Float32Array {
  const out = new Float32Array(sec(0.9));
  const notes = [130.81, 155.56, 196.0, 261.63]; // C3, Es3, G3, C4
  const ph = notes.map(() => 0);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / KIT_RATE;
    let s = 0;
    notes.forEach((f, k) => { ph[k] = (ph[k]! + f / KIT_RATE) % 1; s += ph[k]! * 2 - 1; });
    const cut = 300 + 4000 * Math.exp(-t / 0.15);
    const a = Math.exp((-TWO_PI * cut) / KIT_RATE);
    lp = (1 - a) * (s / 4) + a * lp;
    out[i] = lp * Math.min(1, t / 0.004) * Math.exp(-t / 0.35);
  }
  return normalize(out);
}

/** 16 Klänge für Bank A, Reihenfolge = Pad 1–16. */
export function makeStarterKit(): KitSound[] {
  return [
    { name: 'PW Kick Rund', data: kick(0.7, 160, 48, 0.035, 0.22, 0.3) },
    { name: 'PW Kick Kurz', data: kick(0.35, 220, 60, 0.02, 0.09, 0.6) },
    { name: 'PW Snare Hell', data: snare(0.35, 190, 0.05, 0.12, 1800, 11) },
    { name: 'PW Snare Dumpf', data: snare(0.3, 160, 0.07, 0.08, 700, 12) },
    { name: 'PW Clap', data: clap(13) },
    { name: 'PW HiHat Zu', data: metal(0.12, 0.03, 9000, 14) },
    { name: 'PW HiHat Auf', data: metal(0.7, 0.3, 9000, 15) },
    { name: 'PW Shaker', data: shaker(16) },
    { name: 'PW Tom Tief', data: tom(95, 0.55) },
    { name: 'PW Tom Mitte', data: tom(140, 0.45) },
    { name: 'PW Tom Hoch', data: tom(200, 0.4) },
    { name: 'PW Rim', data: rim() },
    { name: 'PW Glocke', data: cowbell() },
    { name: 'PW Becken', data: metal(1.6, 0.6, 7000, 17) },
    { name: 'PW Bass 808', data: bass808() },
    { name: 'PW Akkord Cm', data: stab() },
  ];
}
