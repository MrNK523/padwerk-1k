import { describe, expect, it } from 'vitest';
import {
  autoSlice, deleteRange, discard, fade, insertSilence, normalize, NORMALIZE_TARGET, peak, reverse, silence,
  sliceEqual, stereoToMono, zeroCrossing,
} from '../../src/dsp/sampleEdit';

const ramp = (n: number) => [Float32Array.from({ length: n }, (_, i) => i / 10)];

describe('Sample-Edits', () => {
  it('DISCARD/EXTRACT behalten nur den Bereich', () => {
    expect([...discard(ramp(10), 2, 5)[0]!]).toEqual([0.2, 0.3, 0.4].map(Math.fround));
  });
  it('DELETE schneidet heraus, der Rest rückt nach', () => {
    expect([...deleteRange(ramp(6), 1, 4)[0]!].map((v) => Math.round(v * 10))).toEqual([0, 4, 5]);
  });
  it('SILENCE nullt den Bereich, Länge bleibt', () => {
    const r = silence(ramp(5), 1, 3)[0]!;
    expect(r.length).toBe(5);
    expect([r[1], r[2]]).toEqual([0, 0]);
    expect(r[3]).toBeCloseTo(0.3);
  });
  it('INSERT SILENCE verlängert am Startpunkt', () => {
    const r = insertSilence(ramp(4), 2, 3)[0]!;
    expect(r.length).toBe(7);
    expect([...r].map((v) => Math.round(v * 10))).toEqual([0, 1, 0, 0, 0, 2, 3]);
  });
  it('NORMALIZE bringt die Spitze auf −0,1 dB, alle Kanäle gleich', () => {
    const r = normalize([new Float32Array([0.25, -0.5]), new Float32Array([0.1, 0])]);
    expect(peak(r)).toBeCloseTo(NORMALIZE_TARGET, 5);
    expect(r[1]![0]).toBeCloseTo(0.2 * NORMALIZE_TARGET, 5);
  });
  it('REVERSE dreht um, Eingabe bleibt unverändert', () => {
    const src = ramp(3);
    expect([...reverse(src)[0]!].map((v) => Math.round(v * 10))).toEqual([2, 1, 0]);
    expect(src[0]![0]).toBe(0);
  });
  it('FADE IN/OUT linear über den Bereich', () => {
    const one = [new Float32Array(5).fill(1)];
    expect([...fade(one, 0, 5, 'in')[0]!]).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([...fade(one, 1, 4, 'out')[0]!]).toEqual([1, 1, 0.5, 0, 1]);
  });
  it('STEREO → MONO mittelt', () => {
    expect([...stereoToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])[0]!]).toEqual([0.5, 0.5]);
  });
});

describe('Schneiden', () => {
  it('SLICE teilt gleichmäßig', () => {
    expect(sliceEqual(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(sliceEqual(10, 41, 2)).toEqual([10, 26, 41]);
  });
  it('Nulldurchgang links und rechts', () => {
    const c = new Float32Array([0.5, 0.4, 0.2, -0.1, -0.3, 0.2, 0.4]);
    expect(zeroCrossing(c, 1, 1)).toBe(3);
    expect(zeroCrossing(c, 6, -1)).toBe(5);
  });
  it('AUTO findet Anschläge einer Schlagfolge', () => {
    const sr = 48000;
    const c = new Float32Array(sr); // 1 s, Schläge bei 0, 250, 500, 750 ms
    for (const ms of [0, 250, 500, 750]) {
      const at = (ms / 1000) * sr;
      for (let i = 0; i < 2400; i++) c[at + i] = Math.sin(i * 0.3) * Math.exp(-i / 600);
    }
    const cuts = autoSlice(c, sr, 0, c.length, { recovery: 50, threshold: 50, max: 64 });
    expect(cuts[0]).toBe(0);
    expect(cuts.at(-1)).toBe(sr);
    const inner = cuts.slice(1, -1).map((f) => Math.round((f / sr) * 1000));
    expect(inner).toHaveLength(3);
    inner.forEach((ms, i) => expect(Math.abs(ms - [250, 500, 750][i]!)).toBeLessThanOrEqual(2));
  });
  it('AUTO hält die Höchstzahl ein', () => {
    const sr = 8000;
    const c = new Float32Array(sr * 2);
    for (let k = 0; k < 40; k++) for (let i = 0; i < 100; i++) c[k * 400 + i] = 1 - i / 100;
    const cuts = autoSlice(c, sr, 0, c.length, { recovery: 10, threshold: 50, max: 8 });
    expect(cuts.length - 1).toBeLessThanOrEqual(8);
  });
});
