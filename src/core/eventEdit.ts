/**
 * Bearbeitung einzelner Events (Step Edit, Grid Edit) – rein, ohne Browser-API.
 * Alle Funktionen verändern die übergebene Event-Liste und halten sie nach Tick sortiert.
 */
import { insertEvent, type NoteEvent } from './sequence';

/** Zwischenablage: Events relativ zum Anfang der Auswahl. */
export interface EventClip { events: NoteEvent[]; span: number }

const sortEvents = (events: NoteEvent[]) => events.sort((a, b) => a.tick - b.tick);

/** Events eines Bereichs [from, to) und optional bestimmter Pads. */
export function eventsInRange(events: readonly NoteEvent[], from: number, to: number, pads?: ReadonlySet<number>): NoteEvent[] {
  return events.filter((e) => e.tick >= from && e.tick < to && (!pads || pads.has(e.pad)));
}

export function removeEvents(events: NoteEvent[], remove: Iterable<NoteEvent>): number {
  const set = new Set(remove);
  const before = events.length;
  const keep = events.filter((e) => !set.has(e));
  events.length = 0;
  events.push(...keep);
  return before - keep.length;
}

/** Kopie für die Zwischenablage; Zeiten relativ zu `origin`. */
export function copyEvents(selected: readonly NoteEvent[], origin: number, span = 0): EventClip {
  return { events: selected.map((e) => ({ ...structuredClone(e), tick: e.tick - origin })), span };
}

/** Einfügen ab `at`; Events hinter `limit` (Sequenzende) entfallen. Gibt die eingefügten Events zurück. */
export function pasteEvents(events: NoteEvent[], clip: EventClip, at: number, limit: number): NoteEvent[] {
  const added: NoteEvent[] = [];
  for (const e of clip.events) {
    const tick = at + e.tick;
    if (tick < 0 || tick >= limit) continue;
    const ev = { ...structuredClone(e), tick };
    insertEvent(events, ev);
    added.push(ev);
  }
  return added;
}

/** MOVE: Auswahl so verschieben, dass das früheste Event bei `to` liegt. */
export function moveEvents(events: NoteEvent[], selected: readonly NoteEvent[], to: number, limit: number): void {
  if (!selected.length) return;
  const first = Math.min(...selected.map((e) => e.tick));
  const d = to - first;
  for (const e of selected) e.tick = Math.min(limit - 1, Math.max(0, e.tick + d));
  sortEvents(events);
}

/** Event neu einsetzen (z. B. nach Änderung der Zeit) und sortieren. */
export function resort(events: NoteEvent[]): void {
  sortEvents(events);
}

/**
 * Loop Edit (JJOS2XL): Schritt umschalten – liegt dort schon ein Event des Pads, wird es gelöscht,
 * sonst eines eingefügt. Gibt true zurück, wenn jetzt ein Event dort liegt.
 */
export function toggleStep(events: NoteEvent[], pad: number, tick: number, width: number, ev: Omit<NoteEvent, 'tick' | 'pad'>): boolean {
  const hit = events.filter((e) => e.pad === pad && e.tick >= tick && e.tick < tick + width);
  if (hit.length) { removeEvents(events, hit); return false; }
  insertEvent(events, { ...ev, pad, tick });
  return true;
}

/** Event eines Pads, das im Fenster [tick, tick + width) beginnt (Event „unter dem Marker“). */
export function eventAt(events: readonly NoteEvent[], pad: number, tick: number, width: number): NoteEvent | undefined {
  return events.find((e) => e.pad === pad && e.tick >= tick && e.tick < tick + Math.max(1, width));
}

/** Nächstes bzw. voriges Event (optional nur eines Pads) ab `tick` – für SHIFT + BAR. */
export function neighbourEvent(events: readonly NoteEvent[], tick: number, dir: 1 | -1, pad?: number): NoteEvent | undefined {
  const list = pad === undefined ? events : events.filter((e) => e.pad === pad);
  if (dir > 0) return list.find((e) => e.tick > tick);
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.tick < tick) return list[i];
  return undefined;
}
