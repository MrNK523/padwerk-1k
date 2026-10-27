import { describe, expect, it } from 'vitest';
import { copyEvents, eventAt, eventsInRange, moveEvents, neighbourEvent, pasteEvents, removeEvents, toggleStep } from '../../src/core/eventEdit';
import type { NoteEvent } from '../../src/core/sequence';

const ev = (tick: number, pad = 0): NoteEvent => ({ tick, pad, velocity: 100, duration: 24 });

describe('Event-Bearbeitung', () => {
  it('Bereich und Pads filtern, löschen', () => {
    const list = [ev(0), ev(24, 1), ev(48), ev(96, 1)];
    expect(eventsInRange(list, 24, 96).map((e) => e.tick)).toEqual([24, 48]);
    expect(eventsInRange(list, 0, 200, new Set([1])).map((e) => e.tick)).toEqual([24, 96]);
    expect(removeEvents(list, [list[1]!])).toBe(1);
    expect(list.map((e) => e.tick)).toEqual([0, 48, 96]);
  });

  it('Kopieren und Einfügen relativ, Sequenzende begrenzt', () => {
    const list = [ev(96), ev(120, 2)];
    const clip = copyEvents(list, 96);
    expect(clip.events.map((e) => e.tick)).toEqual([0, 24]);
    const added = pasteEvents(list, clip, 360, 384);
    expect(added.map((e) => e.tick)).toEqual([360]);
    expect(list.map((e) => e.tick)).toEqual([96, 120, 360]);
    added[0]!.velocity = 1;
    expect(clip.events[0]!.velocity).toBe(100); // Zwischenablage bleibt unverändert
  });

  it('MOVE verschiebt die Auswahl und sortiert', () => {
    const list = [ev(0), ev(48), ev(72)];
    moveEvents(list, [list[1]!, list[2]!], 0, 384);
    expect(list.map((e) => e.tick)).toEqual([0, 0, 24]);
  });

  it('Loop Edit schaltet Schritte um', () => {
    const list: NoteEvent[] = [];
    expect(toggleStep(list, 3, 24, 24, { velocity: 90, duration: 12 })).toBe(true);
    expect(list).toEqual([{ tick: 24, pad: 3, velocity: 90, duration: 12 }]);
    expect(toggleStep(list, 3, 24, 24, { velocity: 90, duration: 12 })).toBe(false);
    expect(list).toHaveLength(0);
  });

  it('Event unter dem Marker und Nachbarn', () => {
    const list = [ev(10, 1), ev(50, 2), ev(90, 1)];
    expect(eventAt(list, 1, 0, 24)?.tick).toBe(10);
    expect(eventAt(list, 2, 0, 24)).toBeUndefined();
    expect(neighbourEvent(list, 10, 1)?.tick).toBe(50);
    expect(neighbourEvent(list, 10, 1, 1)?.tick).toBe(90);
    expect(neighbourEvent(list, 90, -1)?.tick).toBe(50);
  });
});
