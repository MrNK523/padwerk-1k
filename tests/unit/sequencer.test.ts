import { describe, expect, it } from 'vitest';
import { newSequence, setBarCount, type Sequence } from '../../src/core/sequence';
import { SequencerCore, type SeqOutput } from '../../src/core/sequencerCore';

const SR = 48000;
const BLOCK = 128;

interface Hit { frame: number; pad: number; velocity: number }

function rig(opts: { tempo?: number; loop?: boolean } = {}) {
  const core = new SequencerCore(SR);
  const seq: Sequence = newSequence(0, 'p1', { tempo: opts.tempo ?? 120, loop: opts.loop ?? true });
  core.setSequence(seq);
  core.settings.countIn = 'OFF';
  core.settings.clickInRec = false;
  const hits: Hit[] = [];
  const clicks: { frame: number; accent: boolean }[] = [];
  const offs: { frame: number; pad: number }[] = [];
  let blockStart = 0;
  const out: SeqOutput = {
    noteOn: (o, _p, pad, velocity) => hits.push({ frame: blockStart + o, pad, velocity }),
    noteOff: (o, _p, pad) => offs.push({ frame: blockStart + o, pad }),
    click: (o, accent) => clicks.push({ frame: blockStart + o, accent }),
  };
  const run = (frames: number) => {
    for (let done = 0; done < frames; done += BLOCK) { core.process(BLOCK, out); blockStart += BLOCK; }
  };
  const runTicks = (ticks: number) => run(Math.round(ticks * core.framesPerTick));
  return { core, seq, hits, clicks, offs, run, runTicks };
}

const track = (seq: Sequence, i = 0) => seq.tracks[i]!;

describe('Wiedergabe', () => {
  it('120 BPM: Ereignisse frame-genau (1 Tick = 250 Frames)', () => {
    const { core, seq, hits, run } = rig();
    expect(core.framesPerTick).toBe(250);
    const t = track(seq);
    t.used = true;
    t.events = [0, 96, 100, 383].map((tick) => ({ tick, pad: 0, velocity: 100, duration: 10 }));
    core.playStart();
    run(400 * 250);
    expect(hits.map((h) => h.frame)).toEqual([0, 24000, 25000, 95750]);
  });

  it('krumme Tempi: Abweichung höchstens 1 Frame, keine Drift über 8 Takte', () => {
    const { core, seq, hits, run } = rig({ tempo: 97.3 });
    setBarCount(seq, 8);
    const t = track(seq);
    t.used = true;
    t.events = Array.from({ length: 32 }, (_, i) => ({ tick: i * 96, pad: 1, velocity: 100, duration: 10 }));
    core.playStart();
    run(Math.ceil(32 * 96 * core.framesPerTick) + BLOCK);
    expect(hits.length).toBeGreaterThanOrEqual(32);
    hits.slice(0, 32).forEach((h, i) => expect(Math.abs(h.frame - i * 96 * core.framesPerTick)).toBeLessThanOrEqual(1));
  });

  it('Loop: nach 2 Takten wieder von vorn', () => {
    const { core, seq, hits, run } = rig();
    const t = track(seq);
    t.used = true;
    t.events = [{ tick: 0, pad: 0, velocity: 100, duration: 10 }];
    core.playStart();
    run(768 * 250 * 2 + BLOCK);
    expect(hits.map((h) => h.frame)).toEqual([0, 192000, 384000]);
  });

  it('ohne Loop: stoppt am Ende und springt an den Anfang', () => {
    const { core, seq, run } = rig({ loop: false });
    expect(seq.loop).toBe(false);
    core.playStart();
    run(800 * 250);
    expect(core.state).toBe('stopped');
    expect(core.position).toBe(0);
  });

  it('Track-Mute und Vel%', () => {
    const { core, seq, hits, run } = rig();
    track(seq, 0).used = true;
    track(seq, 0).velPct = 50;
    track(seq, 0).events = [{ tick: 0, pad: 0, velocity: 100, duration: 1 }];
    track(seq, 1).used = true;
    track(seq, 1).mute = true;
    track(seq, 1).events = [{ tick: 0, pad: 5, velocity: 100, duration: 1 }];
    core.playStart();
    run(BLOCK * 4);
    expect(hits).toEqual([{ frame: 0, pad: 0, velocity: 50 }]);
  });

  it('Note-Off nach der Dauer', () => {
    const { core, seq, offs, run } = rig();
    track(seq).used = true;
    track(seq).events = [{ tick: 0, pad: 3, velocity: 100, duration: 48 }];
    core.playStart();
    run(60 * 250);
    expect(offs[0]).toEqual({ frame: 48 * 250, pad: 3 });
  });
});

describe('Count-in und Metronom', () => {
  it('REC ONLY: ein Takt Vorzählen mit 4 Klicks, dann Aufnahme ab Takt 1', () => {
    const { core, seq, hits, clicks, run } = rig();
    core.settings.countIn = 'REC_ONLY';
    track(seq).used = true;
    track(seq).events = [{ tick: 0, pad: 0, velocity: 100, duration: 1 }];
    core.record('dub', true);
    expect(core.state).toBe('countin');
    run(384 * 250 + BLOCK);
    expect(clicks.map((c) => c.frame)).toEqual([0, 24000, 48000, 72000]);
    expect(clicks[0]!.accent).toBe(true);
    expect(core.state).toBe('playing');
    expect(Math.abs(hits[0]!.frame - 96000)).toBeLessThanOrEqual(1);
  });

  it('PLAY ohne Count-in (REC ONLY gilt nur für Aufnahme)', () => {
    const { core } = rig();
    core.settings.countIn = 'REC_ONLY';
    core.playStart();
    expect(core.state).toBe('playing');
  });

  it('Klick in der Wiedergabe: jede Viertel, Akzent auf der Eins', () => {
    const { core, clicks, run } = rig();
    core.settings.clickInPlay = true;
    core.playStart();
    run(768 * 250);
    expect(clicks.map((c) => c.frame / 250)).toEqual([0, 96, 192, 288, 384, 480, 576, 672]);
    expect(clicks.filter((c) => c.accent).map((c) => c.frame / 250)).toEqual([0, 384]);
  });
});

describe('Aufnahme', () => {
  it('Timing Correct 1/16: Anschlag bei Tick ~30 landet auf 24; Dauer wie gehalten', () => {
    const { core, seq, runTicks } = rig();
    core.record('dub', true);
    runTicks(30);
    core.recordNoteOn(4, 90);
    runTicks(12);
    core.recordNoteOff(4);
    const ev = track(seq).events[0]!;
    expect(ev.tick).toBe(24);
    expect(ev.pad).toBe(4);
    expect(Math.abs(ev.duration - 12)).toBeLessThanOrEqual(1);
    expect(track(seq).used).toBe(true);
  });

  it('frisch aufgenommene Note klingt im selben Durchlauf nicht doppelt, im nächsten schon', () => {
    const { core, seq, hits, runTicks } = rig();
    core.record('dub', true);
    runTicks(20);
    core.recordNoteOn(0, 100); // → Tick 24, liegt noch vor dem Playhead
    core.recordNoteOff(0);
    runTicks(748 + 30);
    expect(hits).toHaveLength(1);
    expect(Math.abs(hits[0]!.frame - (768 + 24) * 250)).toBeLessThanOrEqual(1);
    expect(track(seq).events).toHaveLength(1);
  });

  it('kurz vor dem Loop-Ende auf die Eins gerundet: kein Doppelschlag', () => {
    const { core, seq, hits, runTicks } = rig();
    core.record('dub', true);
    runTicks(766);
    core.recordNoteOn(0, 100);
    core.recordNoteOff(0);
    expect(track(seq).events[0]!.tick).toBe(0);
    runTicks(768);
    expect(hits).toHaveLength(0); // erster Durchlauf nach dem Umbruch übersprungen (live gespielt)
    runTicks(10);
    expect(hits).toHaveLength(1);
  });

  it('REC ersetzt im ersten Durchlauf und wechselt dann zu Overdub', () => {
    const { core, seq, runTicks } = rig();
    track(seq).used = true;
    track(seq).events = [{ tick: 100, pad: 1, velocity: 100, duration: 1 }, { tick: 500, pad: 2, velocity: 100, duration: 1 }];
    core.record('rec', true);
    runTicks(200);
    core.recordNoteOn(7, 100);
    core.recordNoteOff(7);
    runTicks(600);
    expect(core.recMode).toBe('dub');
    expect(track(seq).events.map((e) => e.pad)).toEqual([7]);
  });

  it('Overdub behält vorhandene Events', () => {
    const { core, seq, runTicks } = rig();
    track(seq).used = true;
    track(seq).events = [{ tick: 100, pad: 1, velocity: 100, duration: 1 }];
    core.record('dub', true);
    runTicks(300);
    core.recordNoteOn(2, 100);
    core.recordNoteOff(2);
    runTicks(600);
    expect(track(seq).events.map((e) => e.pad).sort()).toEqual([1, 2]);
  });

  it('ERASE + Pad löscht beim Überstreichen nur dieses Pad', () => {
    const { core, seq, runTicks } = rig();
    track(seq).used = true;
    track(seq).events = [{ tick: 100, pad: 1, velocity: 100, duration: 1 }, { tick: 100, pad: 2, velocity: 100, duration: 1 }];
    core.record('dub', true);
    core.setErasePads([1]);
    runTicks(200);
    core.setErasePads([]);
    expect(track(seq).events.map((e) => e.pad)).toEqual([2]);
  });

  it('Loop OFF: Aufnahme verlängert die Sequenz bis zum STOP-Takt', () => {
    const { core, seq, runTicks } = rig({ loop: false });
    core.record('rec', true);
    runTicks(384 * 3 + 50); // in Takt 4
    core.stop();
    expect(seq.bars).toHaveLength(4);
  });

  it('Wait for Key: erster Anschlag startet die Aufnahme an der aktuellen Position', () => {
    const { core, seq, runTicks } = rig();
    core.waitForKey('rec');
    runTicks(100);
    expect(core.state).toBe('waiting');
    core.recordNoteOn(3, 100);
    expect(core.state).toBe('playing');
    expect(track(seq).events[0]!.tick).toBe(0);
  });

  it('FIX korrigiert vorhandene Events nachträglich', () => {
    const { core, seq } = rig();
    track(seq).used = true;
    track(seq).events = [{ tick: 13, pad: 0, velocity: 1, duration: 1 }, { tick: 50, pad: 1, velocity: 1, duration: 1 }];
    core.fixTiming();
    expect(track(seq).events.map((e) => e.tick)).toEqual([24, 48]);
  });
});

describe('Note Repeat', () => {
  it('in der Wiedergabe im 1/16-Raster', () => {
    const { core, hits, runTicks } = rig();
    core.playStart();
    runTicks(10);
    core.repeatOn('p1', 5, 100);
    runTicks(100);
    core.repeatOff(5);
    runTicks(100);
    expect(hits.map((h) => Math.round(h.frame / 250))).toEqual([24, 48, 72, 96]);
  });

  it('mit Swing 66 %: jeder zweite Schlag verschoben', () => {
    const { core, hits, runTicks } = rig();
    core.settings.swing = 66;
    core.playStart();
    core.repeatOn('p1', 5, 100);
    runTicks(97);
    core.repeatOff(5);
    expect(hits.map((h) => Math.round(h.frame / 250))).toEqual([0, 32, 48, 80, 96]);
  });

  it('wird bei laufender Aufnahme mit aufgenommen', () => {
    const { core, seq, runTicks } = rig();
    core.record('dub', true);
    core.repeatOn('p1', 2, 80);
    runTicks(49);
    core.repeatOff(2);
    expect(track(seq).events.map((e) => e.tick)).toEqual([0, 24, 48]);
  });

  it('im Stillstand frei laufend, erster Schlag sofort', () => {
    const { core, hits, runTicks } = rig();
    core.repeatOn('p1', 1, 100);
    runTicks(50);
    expect(hits.map((h) => Math.round(h.frame / 250))).toEqual([0, 24, 48]);
  });
});
