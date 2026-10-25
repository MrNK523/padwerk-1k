import { describe, expect, it } from 'vitest';
import { Adsr } from '../../src/dsp/envelope';
import { Svf } from '../../src/dsp/filter';
import { KIT_RATE, makeStarterKit, rng } from '../../src/dsp/kit';
import { attackMs, cutoffHz, decayMs, panGains, veloGain } from '../../src/dsp/params';

describe('Parameter-Umrechnung', () => {
  it('VELO: 0 = volle Dynamik, 100 = immer voll (JJOS2XL-Grafik)', () => {
    expect(veloGain(0, 1)).toBeCloseTo(0);
    expect(veloGain(0, 127)).toBeCloseTo(1);
    expect(veloGain(50, 1)).toBeCloseTo(0.5);
    expect(veloGain(50, 127)).toBeCloseTo(1);
    expect(veloGain(100, 1)).toBeCloseTo(1);
  });
  it('Zeiten steigen monoton, 0 = sofort', () => {
    expect(attackMs(0)).toBe(0);
    expect(decayMs(0)).toBe(0);
    expect(attackMs(50)).toBeLessThan(attackMs(100));
  });
  it('Cutoff 0–100 deckt 20 Hz bis 20 kHz ab', () => {
    expect(cutoffHz(0)).toBeCloseTo(20);
    expect(cutoffHz(100)).toBeCloseTo(20000);
  });
  it('Pan: Mitte voll auf beiden Seiten, Anschlag nur eine Seite', () => {
    expect(panGains(0)[0]).toBeCloseTo(1);
    expect(panGains(0)[1]).toBeCloseTo(1);
    expect(panGains(-50)[1]).toBeCloseTo(0);
    expect(panGains(50)[0]).toBeCloseTo(0);
  });
});

describe('ADSR', () => {
  it('Attack erreicht nach genau attackFrames den Spitzenpegel', () => {
    const e = new Adsr();
    e.trigger({ attackFrames: 100, decayFrames: 0, sustain: 1, releaseFrames: 0 });
    let v = 0;
    for (let i = 0; i < 100; i++) v = e.next();
    expect(v).toBeCloseTo(1, 5);
  });
  it('Decay läuft auf den Sustain-Pegel', () => {
    const e = new Adsr();
    e.trigger({ attackFrames: 0, decayFrames: 1000, sustain: 0.5, releaseFrames: 0 });
    let v = 0;
    for (let i = 0; i < 5000; i++) v = e.next();
    expect(v).toBeCloseTo(0.5, 3);
    expect(e.stage).toBe('sustain');
  });
  it('Release endet in idle; Release 0 = sofort aus', () => {
    const e = new Adsr();
    e.trigger({ attackFrames: 0, decayFrames: 0, sustain: 1, releaseFrames: 0 });
    e.next();
    e.release();
    expect(e.next()).toBe(0);
    expect(e.done).toBe(true);
  });
});

describe('Filter', () => {
  const rms = (f: (x: number) => number, hz: number, sr = 48000) => {
    let acc = 0;
    for (let i = 0; i < sr; i++) {
      const y = f(Math.sin((2 * Math.PI * hz * i) / sr));
      if (i > sr / 2) acc += y * y;
    }
    return Math.sqrt(acc / (sr / 2));
  };
  it('Tiefpass lässt Tiefen durch und dämpft Höhen', () => {
    const f = new Svf();
    f.mode = 'LP';
    f.setParams(500, 0.707, 48000);
    const low = rms((x) => f.process(x), 100);
    f.reset();
    const high = rms((x) => f.process(x), 8000);
    expect(low).toBeGreaterThan(0.6);
    expect(high).toBeLessThan(0.05);
  });
  it('Hochpass verhält sich umgekehrt', () => {
    const f = new Svf();
    f.mode = 'HP';
    f.setParams(2000, 0.707, 48000);
    expect(rms((x) => f.process(x), 100)).toBeLessThan(0.05);
    f.reset();
    expect(rms((x) => f.process(x), 10000)).toBeGreaterThan(0.6);
  });
  it('bleibt stabil bei hoher Resonanz', () => {
    const f = new Svf();
    f.setParams(1000, 14.7, 48000);
    const y = rms((x) => f.process(x), 1000);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('Start-Kit', () => {
  it('liefert 16 Klänge mit Namen ≤ 16 Zeichen', () => {
    const kit = makeStarterKit();
    expect(kit).toHaveLength(16);
    for (const s of kit) {
      expect(s.name.length).toBeLessThanOrEqual(16);
      expect(s.data.length).toBeGreaterThan(KIT_RATE * 0.05);
    }
  });
  it('ist begrenzt (kein Clipping) und nicht stumm', () => {
    for (const s of makeStarterKit()) {
      let peak = 0;
      for (const v of s.data) peak = Math.max(peak, Math.abs(v));
      expect(peak, s.name).toBeGreaterThan(0.5);
      expect(peak, s.name).toBeLessThanOrEqual(0.9);
    }
  });
  it('ist reproduzierbar', () => {
    const a = makeStarterKit()[2]!.data;
    const b = makeStarterKit()[2]!.data;
    expect(a).toEqual(b);
    expect(rng(1)()).toBe(rng(1)());
  });
});
