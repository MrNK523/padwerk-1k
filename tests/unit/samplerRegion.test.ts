import { describe, expect, it } from 'vitest';
import { defaultPlayback, equalChops, newDrumProgram, type SamplePlayback } from '../../src/core/model';
import { resolveRegion, SamplerCore } from '../../src/dsp/sampler';

const SR = 48000;
const BLOCK = 128;
const LEN = 9600;
/** Wert kodiert die Position: Sample i hat den Wert i / LEN · 0,5 */
const ramp = () => new Float32Array(LEN).map((_, i) => (i / LEN) * 0.5);
const posOf = (v: number) => Math.round((v / 0.5) * LEN);

function setup(play: Partial<SamplePlayback>, opts: { noteOn?: boolean; chop?: number } = {}) {
  const core = new SamplerCore(SR);
  core.setSample('s', { channels: [ramp()], sampleRate: SR, play: { ...defaultPlayback(LEN), ...play } });
  const p = newDrumProgram('p', 'T');
  p.pads[0]!.layers[0].sampleId = 's';
  p.pads[0]!.layers[0].chop = opts.chop ?? 0;
  p.pads[0]!.velo = 100;
  if (opts.noteOn) p.pads[0]!.playMode = 'NOTE_ON';
  core.setProgram(p);
  return core;
}

function render(core: SamplerCore, frames: number): number[] {
  const out: number[] = [];
  const l = new Float32Array(BLOCK);
  const r = new Float32Array(BLOCK);
  for (let d = 0; d < frames; d += BLOCK) { core.render(l, r, BLOCK); out.push(...l); }
  return out;
}

describe('Abspielbereich (TRIM)', () => {
  it('Start/Ende begrenzen die Wiedergabe', () => {
    const core = setup({ start: 1000, end: 2000 });
    core.padOn('p', 0, 127);
    const o = render(core, 1280);
    expect(posOf(o[0]!)).toBe(1000);
    expect(posOf(o[999]!)).toBe(1999);
    expect(o[1100]).toBe(0);
    expect(core.activeVoices).toBe(0);
  });

  it('Loop greift nur bei NOTE ON', () => {
    const play = { start: 0, end: 2000, loopOn: true, loopPoint: 1500 };
    const one = setup(play);
    one.padOn('p', 0, 127);
    render(one, 2560);
    expect(one.activeVoices).toBe(0);

    const held = setup(play, { noteOn: true });
    held.padOn('p', 0, 127);
    const o = render(held, 3000);
    expect(posOf(o[1999]!)).toBe(1999);
    expect(posOf(o[2000]!)).toBe(1500); // FWD: zurück zum Loop-Punkt
    expect(posOf(o[2500]!)).toBe(1500);
    expect(held.activeVoices).toBe(1);
  });

  it('ALT-Loop pendelt zwischen Loop-Punkt und Ende', () => {
    const core = setup({ end: 2000, loopOn: true, loopPoint: 1500, loopMode: 'ALT' }, { noteOn: true });
    core.padOn('p', 0, 127);
    const o = render(core, 3000);
    expect(posOf(o[1999]!)).toBe(1999);
    expect(posOf(o[2000]!)).toBe(1998); // rückwärts
    expect(posOf(o[2400]!)).toBe(1598);
    expect(posOf(o[2600]!)).toBeGreaterThan(1500); // wieder vorwärts
  });

  it('XFADE-Loop: Übergang ohne Sprung am Loop-Ende', () => {
    // Sinus mit ganzzahliger Periode – an der Loop-Grenze darf kein Sprung entstehen
    const core = new SamplerCore(SR);
    const data = new Float32Array(LEN * 2).map((_, i) => Math.sin(i * 0.0137) * 0.5 + (i > 12000 ? 0.3 : 0));
    core.setSample('s', { channels: [data], sampleRate: SR, play: { ...defaultPlayback(LEN * 2), end: 18000, loopOn: true, loopPoint: 8000, loopMode: 'XFADE' } });
    const p = newDrumProgram('p', 'T');
    p.pads[0]!.layers[0].sampleId = 's';
    p.pads[0]!.velo = 100;
    p.pads[0]!.playMode = 'NOTE_ON';
    core.setProgram(p);
    core.padOn('p', 0, 127);
    const o = render(core, 19200);
    // Ende (18000) blendet auf Höhe 8000 über → Wert kurz vor/nach der Grenze stetig
    expect(Math.abs(o[18000]! - o[17999]!)).toBeLessThan(0.02);
    expect(o[18000]).toBeCloseTo(data[8000]!, 2);
  });

  it('Chop: Layer spielt nur seinen Chop, ohne Loop', () => {
    const chops = equalChops(0, LEN, 4);
    expect(chops[2]).toEqual({ start: 4800, end: 7200 });
    const core = setup({ chopOn: true, chops, loopOn: true, loopPoint: 0 }, { chop: 3, noteOn: true });
    core.padOn('p', 0, 127);
    const o = render(core, 2560);
    expect(posOf(o[0]!)).toBe(4800);
    expect(o[2400]).toBe(0);
  });

  it('Chop-Nummer ohne Chop ON → normaler Bereich', () => {
    const play = { ...defaultPlayback(LEN), start: 100, chops: equalChops(0, LEN, 4) };
    expect(resolveRegion({ channels: [ramp()], sampleRate: SR, play }, { chop: 2 } as never, false)).toEqual({ start: 100, end: LEN });
  });

  it('REV spielt den Bereich rückwärts', () => {
    const core = setup({ start: 1000, end: 2000 });
    core.setProgram((() => {
      const p = newDrumProgram('p', 'T');
      p.pads[0]!.layers[0].sampleId = 's';
      p.pads[0]!.layers[0].dir = 'REV';
      p.pads[0]!.velo = 100;
      return p;
    })());
    core.padOn('p', 0, 127);
    const o = render(core, 1280);
    expect(posOf(o[0]!)).toBe(1999);
    expect(posOf(o[999]!)).toBe(1000);
  });

  it('Vorhören: ONE SHOT im Bereich, Gate stoppt beim Loslassen', () => {
    const core = setup({});
    core.audition('s', { start: 200, end: 400 }, { gate: false, reverse: false, velocity: 127 });
    const o = render(core, 512);
    expect(posOf(o[0]!)).toBe(200);
    expect(o[300]).toBe(0);
    core.audition('s', { start: 0, end: LEN }, { gate: true, reverse: false, velocity: 127 });
    render(core, 256);
    expect(core.auditioning).toBe(true);
    core.auditionOff();
    render(core, 512);
    expect(core.auditioning).toBe(false);
  });
});
