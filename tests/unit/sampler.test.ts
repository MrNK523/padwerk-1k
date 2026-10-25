import { describe, expect, it } from 'vitest';
import { newDrumProgram, type DrumProgram } from '../../src/core/model';
import { SamplerCore, softClip } from '../../src/dsp/sampler';

const SR = 48000;
const BLOCK = 128;

function setup(len = 4800, fill: (i: number) => number = (i) => (i < 10 ? 0 : 0.5)) {
  const core = new SamplerCore(SR);
  const data = new Float32Array(len).map((_, i) => fill(i));
  core.setSample('s1', { channels: [data], sampleRate: SR });
  const p: DrumProgram = newDrumProgram('p1', 'Test');
  p.pads.forEach((pad) => { pad.layers[0].sampleId = 's1'; });
  core.setProgram(p);
  return { core, p };
}

function renderFrames(core: SamplerCore, frames: number) {
  const L: number[] = [];
  const R: number[] = [];
  const bl = new Float32Array(BLOCK);
  const br = new Float32Array(BLOCK);
  for (let done = 0; done < frames; done += BLOCK) {
    core.render(bl, br, BLOCK);
    L.push(...bl);
    R.push(...br);
  }
  return { L, R };
}

describe('Sampler-Kern', () => {
  it('spielt ein Sample mit voller Velocity unverändert (Pegel 100, Mitte)', () => {
    const { core } = setup();
    core.padOn('p1', 0, 127);
    const { L, R } = renderFrames(core, 1024);
    expect(L[500]).toBeCloseTo(0.5, 3);
    expect(R[500]).toBeCloseTo(0.5, 3);
  });

  it('VELO 0: halbe Velocity → etwa halber Pegel', () => {
    const { core } = setup();
    core.padOn('p1', 0, 64);
    const { L } = renderFrames(core, 1024);
    expect(L[500]).toBeCloseTo(0.5 * (63 / 126), 2);
  });

  it('ONE SHOT spielt bis zum Ende und gibt die Stimme frei', () => {
    const { core } = setup(1000);
    core.padOn('p1', 0, 127);
    core.padOff('p1', 0);
    expect(core.activeVoices).toBe(1);
    renderFrames(core, 1280);
    expect(core.activeVoices).toBe(0);
  });

  it('NOTE ON verstummt kurz nach dem Loslassen', () => {
    const { core, p } = setup(48000);
    p.pads[0]!.playMode = 'NOTE_ON';
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    renderFrames(core, 512);
    core.padOff('p1', 0);
    renderFrames(core, 2048);
    expect(core.activeVoices).toBe(0);
  });

  it('Mute-Gruppe schneidet das andere Pad ab', () => {
    const { core, p } = setup(48000);
    p.pads[0]!.muteGroup = 1;
    p.pads[1]!.muteGroup = 1;
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    renderFrames(core, 256);
    core.padOn('p1', 1, 127);
    renderFrames(core, 512);
    expect(core.voices.filter((v) => v.active).map((v) => v.pad)).toEqual([1]);
  });

  it('Tune +12 spielt doppelt so schnell (endet nach halber Zeit)', () => {
    const { core, p } = setup(4800, () => 0.3);
    p.pads[0]!.layers[0].tune = 12;
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    const { L } = renderFrames(core, 4864);
    expect(Math.abs(L[2300]!)).toBeGreaterThan(0.1);
    expect(L[2500]).toBe(0);
  });

  it('REV spielt rückwärts', () => {
    const { core, p } = setup(4800, (i) => (i < 2400 ? 0 : 0.4));
    p.pads[0]!.layers[0].dir = 'REV';
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    const { L } = renderFrames(core, 4864);
    expect(L[100]).toBeCloseTo(0.4, 2); // rückwärts: zuerst die zweite Hälfte
    expect(Math.abs(L[3000]!)).toBeLessThan(0.01);
  });

  it('nutzt höchstens 32 Stimmen und stiehlt die älteste', () => {
    const { core } = setup(48000);
    for (let i = 0; i < 40; i++) { core.padOn('p1', i % 64, 127); renderFrames(core, 128); }
    expect(core.activeVoices).toBeLessThanOrEqual(32);
  });

  it('SIMULT1 spielt die Ziel-Pads mit', () => {
    const { core, p } = setup(48000);
    p.pads[0]!.muteMode = 'SIMULT1';
    p.pads[0]!.targets = [1, 2, null, null];
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    expect(core.voices.filter((v) => v.active).map((v) => v.pad).sort()).toEqual([0, 1, 2]);
  });

  it('Tiefpass mit Cutoff 0 dämpft fast alles', () => {
    const { core, p } = setup(48000, (i) => Math.sin(i * 0.5) * 0.5);
    p.pads[0]!.filterType = 'LPF';
    p.pads[0]!.filterFreq = 0;
    core.setProgram(p);
    core.padOn('p1', 0, 127);
    const { L } = renderFrames(core, 4096);
    const peak = Math.max(...L.slice(2000).map(Math.abs));
    expect(peak).toBeLessThan(0.01);
  });

  it('Summenbegrenzer ist bis 0,8 linear und bleibt unter 1', () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(5)).toBeLessThanOrEqual(1);
    expect(softClip(1)).toBeLessThan(1);
    expect(softClip(-5)).toBeGreaterThanOrEqual(-1);
  });
});
