/**
 * Automatisches Sichern des Projekts im Browser (IndexedDB) und Wiederherstellen beim Start.
 * Samples werden einzeln und nur bei Änderung geschrieben; der übrige Zustand als JSON.
 * Kein musikalisches Timing – das Zusammenfassen von Änderungen per Timer ist hier unkritisch.
 */
import type { SampleMeta } from '../core/model';
import type { Store } from '../state/store';
import type { ProjectData } from './projectFile';

const DB_NAME = 'padwerk';
const DB_VERSION = 1;
const STATE_KEY = 'state';
/** höchstens alle 2 s schreiben (Aufnahmen melden laufend Änderungen) */
const SAVE_DELAY_MS = 2000;

interface StoredSample { sampleRate: number; channels: Float32Array[] }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

export class Autosave {
  private db: IDBDatabase | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirtySamples = new Set<string>();
  private removedSamples = new Set<string>();
  private clearAll = false;
  private paused = true;
  lastSaved: Date | null = null;
  failed = false;

  constructor(private store: Store) {
    store.on((c) => {
      if (this.paused) return;
      if (c.kind === 'sample') {
        if (c.removed) { this.removedSamples.add(c.id); this.dirtySamples.delete(c.id); } else this.dirtySamples.add(c.id);
      } else if (c.kind === 'project') {
        this.clearAll = true;
        for (const s of store.state.samples) this.dirtySamples.add(s.id);
      }
      this.schedule();
    });
  }

  private async open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') return null;
    try {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples');
      };
      this.db = await req(r);
      return this.db;
    } catch {
      this.failed = true;
      return null;
    }
  }

  /** Letzten Stand laden. true = es gab einen gesicherten Stand. Danach läuft das automatische Sichern. */
  async restore(): Promise<boolean> {
    try {
      const db = await this.open();
      if (!db) return false;
      const tx = db.transaction(['meta', 'samples'], 'readonly');
      const state = await req(tx.objectStore('meta').get(STATE_KEY)) as (Omit<ProjectData, 'samples'> & { samples: SampleMeta[] }) | undefined;
      if (!state) return false;
      const samples = await Promise.all(state.samples.map(async (meta) => {
        const s = await req(tx.objectStore('samples').get(meta.id)) as StoredSample | undefined;
        return s ? { meta, channels: s.channels } : null;
      }));
      this.store.loadProject({ ...state, samples: samples.filter((x): x is NonNullable<typeof x> => !!x) });
      return true;
    } catch (err) {
      console.warn('Wiederherstellen fehlgeschlagen', err);
      return false;
    } finally {
      this.paused = false;
    }
  }

  /** Nach dem Start ohne gesicherten Stand: alles einmal vollständig sichern. */
  startFresh(): void {
    this.paused = false;
    this.clearAll = true;
    for (const s of this.store.state.samples) this.dirtySamples.add(s.id);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, SAVE_DELAY_MS);
  }

  /** Sofort sichern (z. B. beim Verlassen der Seite). */
  async save(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const data = this.store.exportProject('ALL');
    const { samples, ...rest } = data;
    const dirty = [...this.dirtySamples];
    const removed = [...this.removedSamples];
    const clear = this.clearAll;
    this.dirtySamples.clear();
    this.removedSamples.clear();
    this.clearAll = false;
    try {
      const tx = db.transaction(['meta', 'samples'], 'readwrite');
      const ss = tx.objectStore('samples');
      if (clear) ss.clear();
      for (const id of removed) ss.delete(id);
      for (const id of dirty) {
        const s = samples.find((x) => x.meta.id === id);
        if (s) ss.put({ sampleRate: s.meta.sampleRate, channels: s.channels } satisfies StoredSample, id);
      }
      tx.objectStore('meta').put({ ...rest, samples: samples.map((s) => s.meta) }, STATE_KEY);
      await done(tx);
      this.lastSaved = new Date();
      this.failed = false;
    } catch (err) {
      // Speicher voll o. Ä.: beim nächsten Mal alles neu schreiben
      console.warn('Autosave fehlgeschlagen', err);
      this.failed = true;
      this.clearAll = true;
      for (const s of this.store.state.samples) this.dirtySamples.add(s.id);
    }
  }
}
