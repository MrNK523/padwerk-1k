import { describe, expect, it } from 'vitest';
import {
  barStarts, formatBBT, insertEvent, loopRange, newSequence, seqLength, setBarCount, tickToBBT, ticksPerBar, type NoteEvent,
} from '../../src/core/sequence';
import { gridPosition, gridTicks, nextStepAtOrAfter, swingOffset, timingCorrect } from '../../src/core/timing';

describe('Sequenz-Raster (96 PPQ)', () => {
  it('Taktlängen: 4/4 = 384 Ticks, 3/4 = 288, 6/8 = 288, 7/16 = 168', () => {
    expect(ticksPerBar({ num: 4, den: 4 })).toBe(384);
    expect(ticksPerBar({ num: 3, den: 4 })).toBe(288);
    expect(ticksPerBar({ num: 6, den: 8 })).toBe(288);
    expect(ticksPerBar({ num: 7, den: 16 })).toBe(168);
  });
  it('neue Sequenz: 2 Takte 4/4, Loop an, 64 Tracks', () => {
    const s = newSequence(0, 'p');
    expect(seqLength(s)).toBe(768);
    expect(s.loop).toBe(true);
    expect(s.tracks).toHaveLength(64);
    expect(s.name).toBe('Sequence01');
  });
  it('gemischte Taktarten', () => {
    const s = newSequence(0, 'p');
    s.bars = [{ num: 4, den: 4 }, { num: 3, den: 4 }, { num: 4, den: 4 }];
    expect(barStarts(s)).toEqual([0, 384, 672, 1056]);
    expect(formatBBT(s, 0)).toBe('001.01.00');
    expect(formatBBT(s, 384 + 96 + 12)).toBe('002.02.12');
    expect(tickToBBT(s, 672).bar).toBe(3);
  });
  it('zählt hinter dem Ende weiter (Aufnahme mit Loop OFF)', () => {
    const s = newSequence(0, 'p');
    expect(formatBBT(s, 768 + 384)).toBe('004.01.00');
  });
  it('Loop-Bereich mit END und ersten Takt', () => {
    const s = newSequence(0, 'p');
    setBarCount(s, 8);
    s.loopFirst = 3;
    expect(loopRange(s)).toEqual([768, 3072]);
    s.loopLast = 4;
    expect(loopRange(s)).toEqual([768, 1536]);
  });
  it('Change Bars kürzt samt Events', () => {
    const s = newSequence(0, 'p');
    setBarCount(s, 4);
    s.tracks[0]!.events = [{ tick: 100, pad: 0, velocity: 100, duration: 10 }, { tick: 1200, pad: 0, velocity: 100, duration: 10 }];
    setBarCount(s, 2);
    expect(s.tracks[0]!.events.map((e) => e.tick)).toEqual([100]);
  });
  it('Events bleiben sortiert, gleiche Ticks in Einfüge-Reihenfolge', () => {
    const ev: NoteEvent[] = [];
    const mk = (tick: number, pad: number) => ({ tick, pad, velocity: 1, duration: 1 });
    insertEvent(ev, mk(50, 0)); insertEvent(ev, mk(10, 1)); insertEvent(ev, mk(50, 2)); insertEvent(ev, mk(0, 3));
    expect(ev.map((e) => e.pad)).toEqual([3, 1, 0, 2]);
  });
});

describe('Timing Correct', () => {
  it('Rasterweiten wie im JJOS2XL-Handbuch', () => {
    expect(['1/8', '1/8-3', '1/16', '1/16-3', '1/32', '1/32-3', 'OFF'].map((v) => gridTicks(v as never))).toEqual([48, 32, 24, 16, 12, 8, 1]);
  });
  it('rastet auf die nächste 1/16', () => {
    expect(timingCorrect(13, '1/16', 50)).toBe(24);
    expect(timingCorrect(11, '1/16', 50)).toBe(0);
    expect(timingCorrect(383, '1/16', 50)).toBe(384);
  });
  it('Stärke 0 % lässt unverändert, 50 % halbiert den Abstand', () => {
    expect(timingCorrect(30, '1/16', 50, 0)).toBe(30);
    expect(timingCorrect(30, '1/16', 50, 50)).toBe(27);
  });
  it('Swing 50 % = gerade, 66 % ≈ Triole, nur jeder zweite Schritt', () => {
    expect(swingOffset(1, '1/16', 50)).toBe(0);
    expect(gridPosition(1, '1/16', 66)).toBe(32); // 2 · 24 · 0,66 = 31,7 → 32
    expect(gridPosition(2, '1/16', 66)).toBe(48);
    expect(gridPosition(3, '1/16', 75)).toBe(72 + 12);
    expect(swingOffset(1, '1/16-3', 70)).toBe(0);
  });
  it('mit Swing rastet ein Anschlag auf den verschobenen Schritt', () => {
    expect(timingCorrect(30, '1/16', 66)).toBe(32);
    expect(timingCorrect(21, '1/16', 66)).toBe(32);
  });
  it('OFF rundet nur auf ganze Ticks', () => {
    expect(timingCorrect(12.6, 'OFF', 50)).toBe(13);
  });
  it('nächster Rasterschritt für Note Repeat', () => {
    expect(nextStepAtOrAfter(0, '1/16', 50)).toEqual({ index: 0, tick: 0 });
    expect(nextStepAtOrAfter(1, '1/16', 50)).toEqual({ index: 1, tick: 24 });
    expect(nextStepAtOrAfter(25, '1/16', 66)).toEqual({ index: 1, tick: 32 });
  });
});
