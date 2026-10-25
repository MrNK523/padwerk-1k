import { describe, expect, it } from 'vitest';
import { levels16Variation } from '../../src/core/levels16';
import { newDrumProgram, padName, sanitizeName, uniqueName } from '../../src/core/model';
import { layersFor, padsToCut, simultTargets } from '../../src/core/padLogic';
import { Store } from '../../src/state/store';

describe('Modell', () => {
  it('Pad-Namen A01–D16', () => {
    expect(padName(0)).toBe('A01');
    expect(padName(15)).toBe('A16');
    expect(padName(16)).toBe('B01');
    expect(padName(63)).toBe('D16');
  });
  it('Namen: max. 16 Zeichen, Endung weg, eindeutig', () => {
    expect(sanitizeName('Mein langer Breakbeat Loop.wav')).toBe('Mein langer Brea');
    expect(uniqueName('Kick', ['Kick'])).toBe('Kick02');
    expect(uniqueName('Kick', ['Kick', 'Kick02'])).toBe('Kick03');
  });
});

describe('Pad-Logik', () => {
  it('wählt Layer nach Velocity-Bereich', () => {
    const p = newDrumProgram('p', 'x');
    const pad = p.pads[0]!;
    pad.layers[0] = { ...pad.layers[0], sampleId: 'leise', rangeLo: 0, rangeHi: 63 };
    pad.layers[1] = { ...pad.layers[1], sampleId: 'laut', rangeLo: 64, rangeHi: 127 };
    expect(layersFor(pad, 40).map((l) => l.layer.sampleId)).toEqual(['leise']);
    expect(layersFor(pad, 100).map((l) => l.layer.sampleId)).toEqual(['laut']);
  });
  it('Mute-Gruppe stoppt andere Pads der Gruppe, nicht sich selbst (POLY)', () => {
    const p = newDrumProgram('p', 'x');
    [0, 1, 2].forEach((i) => { p.pads[i]!.muteGroup = 1; });
    p.pads[3]!.muteGroup = 2;
    expect([...padsToCut(p, 0)].sort()).toEqual([1, 2]);
    expect([...padsToCut(p, 3)]).toEqual([]);
  });
  it('Mute-Ziele und MONO', () => {
    const p = newDrumProgram('p', 'x');
    p.pads[0]!.targets = [1, 2, 3, null];
    p.pads[5]!.voice = 'MONO';
    expect([...padsToCut(p, 0)].sort()).toEqual([1, 2, 3]);
    expect([...padsToCut(p, 5)]).toEqual([5]);
  });
  it('Simult-Ziele nur in SIMULT-Modi', () => {
    const p = newDrumProgram('p', 'x');
    p.pads[0]!.targets = [1, 2, null, null];
    expect(simultTargets(p, 0)).toEqual([]);
    p.pads[0]!.muteMode = 'SIMULT1';
    expect(simultTargets(p, 0)).toEqual([1, 2]);
    expect([...padsToCut(p, 0)]).toEqual([]);
  });
});

describe('16 Levels', () => {
  it('VELOCITY verteilt 8…127 über die Pads', () => {
    const s = { type: 'VELOCITY' as const, sourcePad: 0, originalKeyPad: 0 };
    expect(levels16Variation(s, 0).velocity).toBe(8);
    expect(levels16Variation(s, 15).velocity).toBe(127);
  });
  it('TUNE: Halbtöne relativ zum Original-Pad', () => {
    const s = { type: 'TUNE' as const, sourcePad: 0, originalKeyPad: 4 };
    expect(levels16Variation(s, 4).tune).toBe(0);
    expect(levels16Variation(s, 0).tune).toBe(-4);
    expect(levels16Variation(s, 15).tune).toBe(11);
  });
});

describe('Store', () => {
  it('meldet Änderungen und sortiert Samples alphabetisch', () => {
    const st = new Store();
    const changes: string[] = [];
    st.on((c) => changes.push(c.kind));
    st.addSample('Snare', { channels: [new Float32Array(10)], sampleRate: 44100 });
    st.addSample('Kick', { channels: [new Float32Array(10)], sampleRate: 44100 });
    expect(st.samplesSorted().map((s) => s.name)).toEqual(['Kick', 'Snare']);
    st.updatePad(st.currentProgram.id, 0, { pan: 10 });
    expect(st.currentProgram.pads[0]!.pan).toBe(10);
    expect(changes).toEqual(['sample', 'sample', 'program']);
  });
  it('Auto-Chromatic: Ursprung = 0, ±1 Halbton je Pad, max. ±3 Oktaven', () => {
    const st = new Store();
    const s = st.addSample('Bass', { channels: [new Float32Array(10)], sampleRate: 44100 });
    const pid = st.currentProgram.id;
    st.updateLayer(pid, 2, 0, { sampleId: s.id });
    st.autoChromatic(pid, 2);
    const pads = st.currentProgram.pads;
    expect(pads[2]!.layers[0].tune).toBe(0);
    expect(pads[0]!.layers[0].tune).toBe(-2);
    expect(pads[38]!.layers[0].tune).toBe(36);
    expect(pads[39]!.layers[0].sampleId).toBeNull();
    expect(pads[10]!.layers[0].sampleId).toBe(s.id);
  });
});
