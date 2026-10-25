import { describe, expect, it } from 'vitest';
import { newDrumProgram } from '../../src/core/model';
import { newSequence } from '../../src/core/sequence';
import { defaultSeqSettings } from '../../src/core/sequencerCore';
import { EngineCore } from '../../src/engine/engineCore';
import type { FromWorklet } from '../../src/engine/protocol';

const SR = 48000;
const N = 128;

function rig(tempo = 120) {
  const posted: FromWorklet[] = [];
  const core = new EngineCore(SR, (m) => posted.push(m));
  // Impuls-Sample: erster Frame 1, sonst 0 → Ausgabe zeigt den Einsatz-Frame exakt
  const data = new Float32Array(64);
  data[0] = 1;
  core.handle({ type: 'sample', id: 's', sampleRate: SR, channels: [data] });
  const p = newDrumProgram('p', 'P');
  p.pads.forEach((pad) => { pad.layers[0].sampleId = 's'; });
  core.handle({ type: 'program', program: p });
  const seq = newSequence(0, 'p', { tempo });
  core.handle({ type: 'sequence', index: 0, seq });
  core.handle({ type: 'seqSettings', settings: { ...defaultSeqSettings(), countIn: 'OFF', clickInRec: false }, activeTrack: 0, soloTrack: null });
  const L: number[] = [];
  const run = (frames: number) => {
    const l = new Float32Array(N);
    const r = new Float32Array(N);
    for (let d = 0; d < frames; d += N) { core.process(l, r, N); L.push(...l); }
  };
  return { core, seq, posted, L, run };
}

const onsets = (L: number[]) => L.flatMap((v, i) => (Math.abs(v) > 0.5 && Math.abs(L[i - 1] ?? 0) < 0.5 ? [i] : []));

describe('Engine-Kern (Sequencer + Sampler)', () => {
  it('Noten setzen sample-genau ein, auch mitten im Block', () => {
    const { core, seq, L, run } = rig();
    seq.tracks[0]!.used = true;
    seq.tracks[0]!.events = [{ tick: 0, pad: 0, velocity: 127, duration: 1 }, { tick: 96, pad: 0, velocity: 127, duration: 1 }, { tick: 97, pad: 1, velocity: 127, duration: 1 }];
    core.handle({ type: 'sequence', index: 0, seq });
    core.handle({ type: 'transport', cmd: 'playStart' });
    run(30000);
    expect(onsets(L)).toEqual([0, 24000, 24250]);
  });

  it('bei 97,3 BPM höchstens 1 Frame Abweichung', () => {
    const { core, seq, L, run } = rig(97.3);
    seq.tracks[0]!.used = true;
    seq.tracks[0]!.events = [1, 2, 3, 4, 5, 6, 7].map((b) => ({ tick: b * 96, pad: 0, velocity: 127, duration: 1 }));
    core.handle({ type: 'sequence', index: 0, seq });
    core.handle({ type: 'transport', cmd: 'playStart' });
    run(260000);
    const fpt = (SR * 60) / (97.3 * 96);
    onsets(L).forEach((f, i) => expect(Math.abs(f - (i + 1) * 96 * fpt)).toBeLessThanOrEqual(1));
    expect(onsets(L)).toHaveLength(7);
  });

  it('Live-Aufnahme: Anschlag wird aufgenommen und an den Hauptthread gemeldet', () => {
    const { core, posted, run } = rig();
    core.handle({ type: 'transport', cmd: 'record', mode: 'dub', fromStart: true });
    run(N * 40); // ~20 Ticks
    core.handle({ type: 'padOn', programId: 'p', pad: 3, velocity: 99, live: true });
    run(N * 10);
    core.handle({ type: 'padOff', programId: 'p', pad: 3, live: true });
    core.handle({ type: 'transport', cmd: 'stop' });
    const tr = posted.filter((m): m is FromWorklet & { type: 'track' } => m.type === 'track').at(-1)!;
    expect(tr.track).toBe(0);
    expect(tr.events[0]).toMatchObject({ tick: 24, pad: 3, velocity: 99 });
    expect(posted.some((m) => m.type === 'pos' && m.state === 'stopped')).toBe(true);
  });

  it('Metronom-Klick belegt keine Stimme', () => {
    const { core, run } = rig();
    core.handle({ type: 'seqSettings', settings: { ...defaultSeqSettings(), countIn: 'OFF', clickInPlay: true }, activeTrack: 0, soloTrack: null });
    core.handle({ type: 'transport', cmd: 'playStart' });
    run(N * 4);
    expect(core.sampler.activeVoices).toBe(0);
  });
});
