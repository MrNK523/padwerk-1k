import { describe, expect, it } from 'vitest';
import { BUTTON_KEYS, PAD_KEYS, keyTarget } from '../../src/input/keyboard';
import { applyFullLevel, velocityFromPosition, VELOCITY_MAX, VELOCITY_MIN } from '../../src/input/velocity';
import { HwBus, type HwEvent } from '../../src/input/events';

describe('Velocity aus Tap-Position', () => {
  it('oben = laut, unten = leise', () => {
    expect(velocityFromPosition(0)).toBe(VELOCITY_MAX);
    expect(velocityFromPosition(1)).toBe(VELOCITY_MIN);
  });
  it('ist monoton fallend', () => {
    let prev = Infinity;
    for (let y = 0; y <= 1; y += 0.05) {
      const v = velocityFromPosition(y);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it('begrenzt Werte außerhalb des Pads', () => {
    expect(velocityFromPosition(-0.5)).toBe(VELOCITY_MAX);
    expect(velocityFromPosition(2)).toBe(VELOCITY_MIN);
    expect(velocityFromPosition(Number.NaN)).toBe(VELOCITY_MAX);
  });
  it('Full Level überschreibt die Velocity', () => {
    expect(applyFullLevel(40, true)).toBe(127);
    expect(applyFullLevel(40, false)).toBe(40);
    expect(applyFullLevel(40, true, 100)).toBe(100);
  });
});

describe('Tastatur-Belegung', () => {
  it('belegt alle 16 Pads genau einmal', () => {
    const pads = Object.values(PAD_KEYS).sort((a, b) => a - b);
    expect(pads).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });
  it('Pad-Block ist wie die Pads angeordnet (Pad 1 unten links, Pad 16 oben rechts)', () => {
    expect(keyTarget('KeyZ')).toEqual({ kind: 'pad', pad: 0 });
    expect(keyTarget('Digit4')).toEqual({ kind: 'pad', pad: 15 });
  });
  it('Pad-Tasten und Funktionstasten überschneiden sich nicht', () => {
    for (const code of Object.keys(PAD_KEYS)) expect(BUTTON_KEYS[code]).toBeUndefined();
  });
  it('unbekannte Tasten werden ignoriert', () => {
    expect(keyTarget('KeyÜ')).toBeNull();
  });
});

describe('HwBus', () => {
  it('verteilt Ereignisse und lässt sich abmelden', () => {
    const bus = new HwBus();
    const got: HwEvent[] = [];
    const off = bus.on((e) => got.push(e));
    bus.emit({ kind: 'wheel', delta: 1, source: 'test' });
    off();
    bus.emit({ kind: 'wheel', delta: -1, source: 'test' });
    expect(got).toHaveLength(1);
  });
});
