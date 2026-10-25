import { describe, expect, it } from 'vitest';
import { allocateVoice, countActive, createSlots, MAX_VOICES } from '../../src/dsp/voicePool';
import { NOTE_BASE, padToNote } from '../../src/engine/protocol';

describe('Stimmen-Pool', () => {
  it('hat 32 Stimmen wie das Original', () => {
    expect(createSlots()).toHaveLength(MAX_VOICES);
    expect(MAX_VOICES).toBe(32);
  });

  it('nimmt zuerst freie Stimmen', () => {
    const slots = createSlots(4);
    slots[0]!.active = true;
    expect(allocateVoice(slots)).toEqual({ index: 1, stolen: false });
  });

  it('stiehlt bei Überlauf die älteste Stimme', () => {
    const slots = createSlots(3);
    slots.forEach((s, i) => { s.active = true; s.startFrame = [300, 100, 200][i]!; });
    expect(allocateVoice(slots)).toEqual({ index: 1, stolen: true });
    expect(countActive(slots)).toBe(3);
  });
});

describe('Pad- und Notenzuordnung', () => {
  it('A01 = Note 36, D16 = Note 99 (fest, laut JJOS2XL)', () => {
    expect(padToNote(0, 0)).toBe(NOTE_BASE);
    expect(padToNote(0, 0)).toBe(36);
    expect(padToNote(3, 15)).toBe(99);
    expect(padToNote(1, 0)).toBe(52);
  });
});
