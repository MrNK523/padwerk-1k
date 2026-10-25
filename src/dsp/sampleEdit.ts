/**
 * Destruktive Sample-Bearbeitung – rein, ohne Browser-API. Jede Funktion liefert neue Kanäle
 * und verändert die Eingabe nicht. Funktionen nach MPC1000-Handbuch Kap. 11 und JJOS2XL TRIM.
 * Bereiche sind halboffen: [start, end).
 */

export type Channels = Float32Array[];

const clampRange = (len: number, start: number, end: number): [number, number] => {
  const s = Math.max(0, Math.min(len, Math.round(start)));
  const e = Math.max(s, Math.min(len, Math.round(end)));
  return [s, e];
};

/** DISCARD: nur [start, end) behalten. */
export function discard(ch: Channels, start: number, end: number): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  return ch.map((c) => c.slice(s, e));
}

/** EXTRACT: [start, end) als neues Sample (wie DISCARD, Original bleibt). */
export const extract = discard;

/** DELETE: [start, end) herausschneiden, der Rest rückt nach vorn. */
export function deleteRange(ch: Channels, start: number, end: number): Channels {
  const len = ch[0]?.length ?? 0;
  const [s, e] = clampRange(len, start, end);
  return ch.map((c) => {
    const out = new Float32Array(len - (e - s));
    out.set(c.subarray(0, s), 0);
    out.set(c.subarray(e), s);
    return out;
  });
}

/** SILENCE: [start, end) stumm schalten. */
export function silence(ch: Channels, start: number, end: number): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  return ch.map((c) => { const out = c.slice(); out.fill(0, s, e); return out; });
}

/** INSERT SILENCE (JJOS2XL): Stille der Länge `frames` am Startpunkt einfügen. */
export function insertSilence(ch: Channels, at: number, frames: number): Channels {
  const len = ch[0]?.length ?? 0;
  const p = Math.max(0, Math.min(len, Math.round(at)));
  const n = Math.max(0, Math.round(frames));
  return ch.map((c) => {
    const out = new Float32Array(len + n);
    out.set(c.subarray(0, p), 0);
    out.set(c.subarray(p), p + n);
    return out;
  });
}

/** Höchster Betrag über alle Kanäle. */
export function peak(ch: Channels): number {
  let m = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]!); if (a > m) m = a; }
  return m;
}

/** NORMALIZE: lauteste Stelle auf knapp unter 0 dBFS (−0,1 dB), alle Kanäle gleich. Optional nur ein Bereich (Chop). */
export const NORMALIZE_TARGET = Math.pow(10, -0.1 / 20);
export function normalize(ch: Channels, start = 0, end = Infinity): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  const p = peak(ch.map((c) => c.subarray(s, e)));
  if (p === 0) return ch.map((c) => c.slice());
  const g = NORMALIZE_TARGET / p;
  return ch.map((c) => { const out = c.slice(); for (let i = s; i < e; i++) out[i] = c[i]! * g; return out; });
}

/** REVERSE: ganzes Sample rückwärts (Handbuch: „reverse the selected sample“); optional nur ein Bereich (Chop). */
export function reverse(ch: Channels, start = 0, end = Infinity): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  return ch.map((c) => { const out = c.slice(); out.subarray(s, e).reverse(); return out; });
}

/** BIT CONVERT (JJOS2XL): auf 4–12 Bit quantisieren; Dateigröße bleibt. */
export function bitConvert(ch: Channels, bits: number, start = 0, end = Infinity): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  const q = Math.pow(2, Math.max(1, Math.min(16, Math.round(bits))) - 1);
  return ch.map((c) => { const out = c.slice(); for (let i = s; i < e; i++) out[i] = Math.round(c[i]! * q) / q; return out; });
}

/**
 * RING MODULATION (JJOS2XL): Original × Oszillator (Sinus/Rechteck, 100–5000 Hz).
 * Mix 1–10: 1 = 90 % Original / 10 % Effekt … 10 = nur Effekt (Handbuch).
 */
export function ringMod(
  ch: Channels, sampleRate: number, opts: { freq: number; wave: 'SINE' | 'SQUARE'; mix: number }, start = 0, end = Infinity,
): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  const wet = Math.max(1, Math.min(10, Math.round(opts.mix))) / 10;
  const w = (2 * Math.PI * opts.freq) / sampleRate;
  return ch.map((c) => {
    const out = c.slice();
    for (let i = s; i < e; i++) {
      const sn = Math.sin(w * (i - s));
      const osc = opts.wave === 'SINE' ? sn : sn >= 0 ? 1 : -1;
      out[i] = c[i]! * (1 - wet) + c[i]! * osc * wet;
    }
    return out;
  });
}

/** Linear auf eine andere Samplerate umrechnen (für COMBINE/MIX mit fremder Rate). */
export function resample(c: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return c.slice();
  const n = Math.max(1, Math.round((c.length * to) / from));
  const out = new Float32Array(n);
  const r = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * r;
    const k = Math.floor(x);
    const t = x - k;
    out[i] = (c[k] ?? 0) * (1 - t) + (c[k + 1] ?? c[k] ?? 0) * t;
  }
  return out;
}

/** Kanalzahl angleichen: Mono wird auf beide Seiten verteilt. */
function toChannels(ch: Channels, n: number): Channels {
  if (ch.length === n) return ch;
  if (n === 1) return stereoToMono(ch);
  return [ch[0]!, ch[0]!];
}

/** COMBINE (JJOS2XL): Sample B hinter Sample A hängen. Rate und Kanäle richten sich nach A. */
export function combine(a: Channels, srA: number, b: Channels, srB: number): Channels {
  const n = a.length;
  const bb = toChannels(b, n).map((c) => resample(c, srB, srA));
  return a.map((c, i) => { const out = new Float32Array(c.length + bb[i]!.length); out.set(c); out.set(bb[i]!, c.length); return out; });
}

/** MIX (JJOS2XL): A und B übereinanderlegen, Pegel je 0–100 %. Länge = längeres Sample. */
export function mix(a: Channels, srA: number, b: Channels, srB: number, levelA = 100, levelB = 100): Channels {
  const n = Math.max(a.length, b.length);
  const aa = toChannels(a, n);
  const bb = toChannels(b, n).map((c) => resample(c, srB, srA));
  const ga = levelA / 100;
  const gb = levelB / 100;
  return aa.map((c, i) => {
    const d = bb[i]!;
    const out = new Float32Array(Math.max(c.length, d.length));
    for (let k = 0; k < out.length; k++) out[k] = (c[k] ?? 0) * ga + (d[k] ?? 0) * gb;
    return out;
  });
}

/** FADE IN/OUT (JJOS2XL): linear über [start, end); vor bzw. nach dem Bereich unverändert. */
export function fade(ch: Channels, start: number, end: number, dir: 'in' | 'out'): Channels {
  const [s, e] = clampRange(ch[0]?.length ?? 0, start, end);
  const n = e - s;
  return ch.map((c) => {
    const out = c.slice();
    for (let i = 0; i < n; i++) {
      const g = n <= 1 ? (dir === 'in' ? 1 : 0) : dir === 'in' ? i / (n - 1) : 1 - i / (n - 1);
      out[s + i] = c[s + i]! * g;
    }
    return out;
  });
}

/** STEREO → MONO (L+R gemittelt). */
export function stereoToMono(ch: Channels): Channels {
  if (ch.length < 2) return ch.map((c) => c.slice());
  const [l, r] = ch as [Float32Array, Float32Array];
  return [l.map((v, i) => (v + r[i]!) * 0.5)];
}

/**
 * Nächster Nulldurchgang ab `from` in Richtung `dir` (Vorzeichenwechsel im ersten Kanal).
 * JJOS2XL: Zcross-Tasten im Joint-Fenster. Kein Treffer → Ausgangsposition.
 */
export function zeroCrossing(c: Float32Array, from: number, dir: -1 | 1): number {
  const n = c.length;
  let i = Math.max(1, Math.min(n - 1, Math.round(from))) + dir;
  for (; i > 0 && i < n; i += dir) {
    const a = c[i - 1]!;
    const b = c[i]!;
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0) || b === 0) return i;
  }
  return Math.max(0, Math.min(n, Math.round(from)));
}

/** Gleichmäßige Unterteilung in `count` Regionen (SLICE). Liefert Startpunkte + Ende. */
export function sliceEqual(start: number, end: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  const len = end - start;
  return Array.from({ length: n + 1 }, (_, i) => Math.round(start + (len * i) / n));
}

/**
 * AUTO (Auto Slice): Anschläge erkennen und dort teilen.
 * ANNAHME A-22: Recovery time 10–100 = Mindestabstand zweier Anschläge in Millisekunden;
 * Threshold 0–100 = Schwelle von −60 dB bis 0 dB relativ zur lautesten Stelle.
 * Ein Anschlag ist ein Anstieg der Hüllkurve über die Schwelle, nachdem sie unter die halbe Schwelle gefallen war.
 */
export function autoSlice(
  c: Float32Array, sampleRate: number, start: number, end: number,
  opts: { recovery: number; threshold: number; max: number },
): number[] {
  const s = Math.max(0, Math.round(start));
  const e = Math.min(c.length, Math.round(end));
  if (e - s < 2) return [s, e];
  // Hüllkurve: schneller Anstieg, Abfall ~10 ms
  const rel = Math.exp(-1 / (sampleRate * 0.01));
  const env = new Float32Array(e - s);
  let level = 0;
  let pk = 0;
  for (let i = s; i < e; i++) {
    const a = Math.abs(c[i]!);
    level = a > level ? a : level * rel;
    env[i - s] = level;
    if (level > pk) pk = level;
  }
  if (pk === 0) return [s, e];
  const thrDb = -60 + (Math.min(100, Math.max(0, opts.threshold)) / 100) * 60;
  const thr = pk * Math.pow(10, thrDb / 20);
  const low = thr * 0.5; // Hysterese: erst unter die halbe Schwelle, dann erneut darüber
  const minGap = Math.round((Math.min(100, Math.max(10, opts.recovery)) / 1000) * sampleRate);
  const cuts = [s];
  let armed = false;
  let last = s;
  for (let i = 0; i < env.length; i++) {
    const v = env[i]!;
    if (v < low) armed = true;
    else if (armed && v >= thr && s + i - last >= minGap) {
      // Schnitt kurz vor den Anstieg legen (1 ms), damit der Transient erhalten bleibt
      const at = Math.max(last + 1, s + i - Math.round(sampleRate * 0.001));
      cuts.push(at);
      last = at;
      armed = false;
      if (cuts.length >= opts.max) break;
    }
  }
  cuts.push(e);
  return cuts;
}
