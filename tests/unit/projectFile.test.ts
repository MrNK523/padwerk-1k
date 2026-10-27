import { describe, expect, it } from 'vitest';
import { decodeProject, encodeProject, isProjectFile, ProjectFormatError, safeFileName } from '../../src/io/projectFile';
import { Store } from '../../src/state/store';

function filledStore(): Store {
  const s = new Store();
  const a = s.addSample('Kick', { channels: [new Float32Array([0, 0.5, -0.25])], sampleRate: 44100 });
  const b = s.addSample('Loop', { channels: [new Float32Array([1, 2]), new Float32Array([3, 4])], sampleRate: 48000 });
  s.updateSampleMeta(b.id, { loopOn: true, loopPoint: 1 });
  const pid = s.currentProgram.id;
  s.updateLayer(pid, 0, 0, { sampleId: a.id });
  s.updateLayer(pid, 1, 0, { sampleId: b.id, tune: 3 });
  s.updateSequence((q) => { q.tempo = 93.5; q.tracks[0]!.events.push({ tick: 24, pad: 1, velocity: 99, duration: 12 }); q.tracks[0]!.used = true; });
  return s;
}

describe('Projektdatei .padwerk', () => {
  it('ALL: verlustfreier Rundlauf über die Datei', () => {
    const s = filledStore();
    const buf = encodeProject(s.exportProject('ALL'));
    expect(isProjectFile(buf)).toBe(true);
    const d = decodeProject(buf);
    const t = new Store();
    t.loadProject(d);
    expect(t.state.samples.map((x) => x.name)).toEqual(['Kick', 'Loop']);
    const loop = t.state.samples[1]!;
    expect(loop.loopOn).toBe(true);
    expect([...t.sampleAudio(loop.id)!.channels[1]!]).toEqual([3, 4]);
    expect(t.sampleAudio(t.state.samples[0]!.id)!.sampleRate).toBe(44100);
    expect(t.currentProgram.pads[1]!.layers[0].tune).toBe(3);
    expect(t.currentSequence.tempo).toBe(93.5);
    expect(t.currentSequence.tracks[0]!.events).toHaveLength(1);
    // neue Objekte kollidieren nicht mit geladenen IDs
    const n = t.addSample('Neu', { channels: [new Float32Array(1)], sampleRate: 44100 });
    expect(t.state.samples.filter((x) => x.id === n.id)).toHaveLength(1);
  });

  it('PROGRAM: wird mit neuen IDs zusätzlich geladen, Namen eindeutig', () => {
    const s = filledStore();
    const d = decodeProject(encodeProject(s.exportProject('PROGRAM')));
    expect(d.samples).toHaveLength(2);
    const p = s.mergeProgram(d)!;
    expect(s.state.programs).toHaveLength(2);
    expect(p.name).toBe('Program02');
    expect(s.state.samples.map((x) => x.name)).toContain('Kick02');
    expect(s.sample(p.pads[0]!.layers[0].sampleId)!.name).toBe('Kick02');
  });

  it('SEQUENCE: in einen anderen Platz laden', () => {
    const s = filledStore();
    const d = decodeProject(encodeProject(s.exportProject('SEQUENCE')));
    expect(s.loadSequenceInto(d, 4)).toBe(true);
    expect(s.state.sequences[4]!.tracks[0]!.events[0]!.velocity).toBe(99);
  });

  it('ergänzt fehlende Felder älterer Dateien', () => {
    const s = filledStore();
    const d = s.exportProject('ALL');
    const old = structuredClone(d);
    for (const x of old.samples) {
      x.channels = d.samples.find((y) => y.meta.id === x.meta.id)!.channels;
      delete (x.meta as Partial<typeof x.meta>).chops;
      delete (x.meta as Partial<typeof x.meta>).loopMode;
    }
    delete (old.programs[0]!.pads[0]!.layers[0] as Partial<(typeof old.programs)[0]['pads'][0]['layers'][0]>).chop;
    const t = new Store();
    t.loadProject(old);
    expect(t.state.samples[0]!.chops).toEqual([]);
    expect(t.state.samples[0]!.loopMode).toBe('FWD');
    expect(t.currentProgram.pads[0]!.layers[0].chop).toBe(0);
  });

  it('erkennt fremde und beschädigte Dateien', () => {
    expect(isProjectFile(new ArrayBuffer(4))).toBe(false);
    expect(() => decodeProject(new TextEncoder().encode('RIFF....').buffer)).toThrow(ProjectFormatError);
    const buf = encodeProject(filledStore().exportProject('ALL'));
    expect(() => decodeProject(buf.slice(0, buf.byteLength - 4))).toThrow(ProjectFormatError);
  });

  it('Neues Projekt leert alles', () => {
    const s = filledStore();
    s.newProject();
    expect(s.state.samples).toHaveLength(0);
    expect(s.state.programs).toHaveLength(1);
    expect(s.currentSequence.tracks[0]!.events).toHaveLength(0);
  });

  it('sichere Dateinamen', () => {
    expect(safeFileName('Mein Beat/1', '.padwerk')).toBe('Mein_Beat_1.padwerk');
  });
});
