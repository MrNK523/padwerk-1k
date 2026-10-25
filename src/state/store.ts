import {
  type DrumProgram, type Layer, type PadParams, type SampleMeta, type SamplePlayback,
  MAX_PROGRAMS, clampPlayback, defaultPlayback, newDrumProgram, sanitizeName, uniqueName,
} from '../core/model';
import { MAX_SEQUENCES, newSequence, type NoteEvent, type Sequence, type TimeSig, type Track } from '../core/sequence';
import { defaultSeqSettings, type SeqSettings } from '../core/sequencerCore';

/** Audiodaten liegen getrennt von den (serialisierbaren) Metadaten. */
export interface SampleAudio {
  /** 1 oder 2 Kanäle, gleiche Länge */
  channels: Float32Array[];
  sampleRate: number;
}

export type Change =
  | { kind: 'sample'; id: string; removed?: boolean }
  /** nur Wiedergabe-Einstellungen (Start/Ende/Loop/Chops) geändert – Audiodaten unverändert */
  | { kind: 'sample-meta'; id: string }
  | { kind: 'program'; id: string; removed?: boolean }
  | { kind: 'current-program'; id: string }
  /** `fromEngine` = Änderung kam aus dem Worklet (Aufnahme) und muss nicht zurückgespiegelt werden */
  | { kind: 'sequence'; index: number; fromEngine?: boolean }
  | { kind: 'seq-settings' };

export type ChangeListener = (c: Change) => void;

export interface ProjectState {
  samples: SampleMeta[];
  programs: DrumProgram[];
  currentProgramId: string;
  /** 99 Plätze; null = ungenutzt („(unused)“) */
  sequences: (Sequence | null)[];
  currentSeq: number;
  activeTrack: number;
  soloTrack: number | null;
  seqSettings: SeqSettings;
}

/**
 * Zentraler Store. Alle Änderungen laufen über seine Methoden und melden eine `Change`.
 * Die Engine hört mit und spiegelt Programs und Samples ins AudioWorklet.
 */
export class Store {
  readonly state: ProjectState;
  private audio = new Map<string, SampleAudio>();
  private listeners = new Set<ChangeListener>();
  private nextId = 1;

  constructor() {
    const first = newDrumProgram(this.id('p'), 'Program01');
    this.state = {
      samples: [], programs: [first], currentProgramId: first.id,
      sequences: Array.from({ length: MAX_SEQUENCES }, () => null),
      currentSeq: 0, activeTrack: 0, soloTrack: null, seqSettings: defaultSeqSettings(),
    };
    this.state.sequences[0] = newSequence(0, first.id);
  }

  private undoSnapshot: { index: number; seq: Sequence } | null = null;
  /** true = letzte Aufnahme ist gerade zurückgenommen (UNDO-LED aus) */
  private undone = false;

  private id(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  on(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change): void {
    for (const fn of this.listeners) fn(c);
  }

  // ---------- Samples ----------

  /** Fügt ein Sample hinzu; der Name wird gekürzt und eindeutig gemacht. */
  addSample(rawName: string, audio: SampleAudio, rootNote = 60, playback?: SamplePlayback): SampleMeta {
    const name = uniqueName(sanitizeName(rawName), this.state.samples.map((s) => s.name));
    const ch = audio.channels.slice(0, 2);
    const frames = ch[0]?.length ?? 0;
    const meta: SampleMeta = {
      id: this.id('s'),
      name,
      sampleRate: audio.sampleRate,
      channels: ch.length === 2 ? 2 : 1,
      frames,
      rootNote,
      ...(playback ? clampPlayback(playback, frames) : defaultPlayback(frames)),
    };
    this.audio.set(meta.id, { channels: ch, sampleRate: audio.sampleRate });
    this.state.samples.push(meta);
    this.emit({ kind: 'sample', id: meta.id });
    return meta;
  }

  /** Start/Ende/Loop/Chops ändern (TRIM). Werte werden auf die Sample-Länge begrenzt. */
  updateSampleMeta(id: string, patch: Partial<SamplePlayback>): void {
    const m = this.sample(id);
    if (!m) return;
    Object.assign(m, clampPlayback({ ...m, ...patch }, m.frames));
    this.emit({ kind: 'sample-meta', id });
  }

  /** Audiodaten ersetzen (destruktive Bearbeitung, OVER W). */
  replaceSampleAudio(id: string, channels: Float32Array[], playback?: Partial<SamplePlayback>): void {
    const m = this.sample(id);
    const a = this.audio.get(id);
    if (!m || !a) return;
    const ch = channels.slice(0, 2);
    a.channels = ch;
    m.frames = ch[0]?.length ?? 0;
    m.channels = ch.length === 2 ? 2 : 1;
    Object.assign(m, clampPlayback({ ...m, ...playback }, m.frames));
    this.emit({ kind: 'sample', id });
  }

  renameSample(id: string, raw: string): void {
    const m = this.sample(id);
    if (!m) return;
    m.name = uniqueName(sanitizeName(raw), this.state.samples.filter((s) => s.id !== id).map((s) => s.name));
    this.emit({ kind: 'sample-meta', id });
  }

  /** Sample löschen; Pads, die es nutzen, werden leer (wie am Gerät). */
  removeSample(id: string): void {
    const i = this.state.samples.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.state.samples.splice(i, 1);
    this.audio.delete(id);
    for (const p of this.state.programs) {
      let used = false;
      for (const pad of p.pads) for (const l of pad.layers) if (l.sampleId === id) { l.sampleId = null; l.chop = 0; used = true; }
      if (used) this.emit({ kind: 'program', id: p.id });
    }
    this.emit({ kind: 'sample', id, removed: true });
  }

  /** Kopie mit eigenem Namen (Sample-Fenster COPY). */
  copySample(id: string, rawName: string): SampleMeta | undefined {
    const m = this.sample(id);
    const a = this.audio.get(id);
    if (!m || !a) return undefined;
    const { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops } = m;
    return this.addSample(rawName, { channels: a.channels.map((c) => c.slice()), sampleRate: a.sampleRate }, m.rootNote,
      { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops: chops.map((r) => ({ ...r })) });
  }

  sample(id: string | null): SampleMeta | undefined {
    return id ? this.state.samples.find((s) => s.id === id) : undefined;
  }

  sampleAudio(id: string): SampleAudio | undefined {
    return this.audio.get(id);
  }

  /** Sample-Liste wie am Gerät: immer alphabetisch. */
  samplesSorted(): SampleMeta[] {
    return [...this.state.samples].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  // ---------- Programs ----------

  get currentProgram(): DrumProgram {
    return this.program(this.state.currentProgramId)!;
  }

  program(id: string): DrumProgram | undefined {
    return this.state.programs.find((p) => p.id === id);
  }

  setCurrentProgram(id: string): void {
    if (!this.program(id) || id === this.state.currentProgramId) return;
    this.state.currentProgramId = id;
    this.emit({ kind: 'current-program', id });
  }

  newProgram(name?: string): DrumProgram | null {
    if (this.state.programs.length >= MAX_PROGRAMS) return null;
    const n = name ?? uniqueName('Program01', this.state.programs.map((p) => p.name));
    const p = newDrumProgram(this.id('p'), n);
    this.state.programs.push(p);
    this.emit({ kind: 'program', id: p.id });
    return p;
  }

  copyProgram(id: string): DrumProgram | null {
    const src = this.program(id);
    if (!src || this.state.programs.length >= MAX_PROGRAMS) return null;
    const p: DrumProgram = { ...structuredClone(src), id: this.id('p'), name: uniqueName(src.name, this.state.programs.map((x) => x.name)) };
    this.state.programs.push(p);
    this.emit({ kind: 'program', id: p.id });
    return p;
  }

  /** Ändert Pad-Parameter (flach) eines Programs. */
  updatePad(programId: string, pad: number, patch: Partial<Omit<PadParams, 'layers'>>): void {
    const p = this.program(programId);
    const params = p?.pads[pad];
    if (!params) return;
    Object.assign(params, patch);
    this.emit({ kind: 'program', id: programId });
  }

  updateLayer(programId: string, pad: number, layer: 0 | 1 | 2, patch: Partial<Layer>): void {
    const l = this.program(programId)?.pads[pad]?.layers[layer];
    if (!l) return;
    Object.assign(l, patch);
    this.emit({ kind: 'program', id: programId });
  }

  /** Kopiert alle Parameter eines Pads auf andere Pads (Copy Pad). */
  copyPad(programId: string, from: number, to: number[]): void {
    const p = this.program(programId);
    const src = p?.pads[from];
    if (!p || !src) return;
    for (const t of to) if (t !== from && p.pads[t]) p.pads[t] = structuredClone(src);
    this.emit({ kind: 'program', id: programId });
  }

  /**
   * Auto-Chromatic (JJOS2XL, SHIFT+F5 CHROM.): Pad `origin` bekommt TUNE 0,
   * jedes Pad darüber +1 Halbton, darunter −1, begrenzt auf ±3 Oktaven. Sample von `origin` auf alle Pads.
   */
  autoChromatic(programId: string, origin: number): void {
    const p = this.program(programId);
    const src = p?.pads[origin];
    if (!p || !src) return;
    const base = structuredClone(src.layers[0]);
    p.pads.forEach((pad, i) => {
      const semis = i - origin;
      if (Math.abs(semis) > 36) return; // Handbuch: maximal ±3 Oktaven
      pad.layers[0] = { ...structuredClone(base), tune: semis };
    });
    this.emit({ kind: 'program', id: programId });
  }

  // ---------- Sequenzen ----------

  get currentSequence(): Sequence {
    return this.ensureSequence(this.state.currentSeq);
  }

  /** Ungenutzte Sequenz beim ersten Gebrauch anlegen (Werte wie neue Sequenz am Gerät). */
  ensureSequence(index: number): Sequence {
    let seq = this.state.sequences[index];
    if (!seq) {
      seq = newSequence(index, this.state.currentProgramId);
      this.state.sequences[index] = seq;
    }
    return seq;
  }

  setCurrentSeq(index: number): void {
    const i = Math.min(MAX_SEQUENCES - 1, Math.max(0, index));
    if (i === this.state.currentSeq) return;
    this.state.currentSeq = i;
    this.undoSnapshot = null;
    this.emit({ kind: 'sequence', index: i });
    this.syncProgramToTrack();
  }

  get activeTrack(): Track {
    return this.currentSequence.tracks[this.state.activeTrack]!;
  }

  setActiveTrack(index: number): void {
    const i = Math.min(63, Math.max(0, index));
    if (i === this.state.activeTrack) return;
    this.state.activeTrack = i;
    this.emit({ kind: 'seq-settings' });
    this.syncProgramToTrack();
  }

  /** Program des aktiven Tracks wird das spielbare Program (wie am Gerät: Pgm-Feld im Main-Screen). */
  private syncProgramToTrack(): void {
    const pid = this.activeTrack.programId;
    if (this.program(pid)) this.setCurrentProgram(pid);
  }

  /** Program dem aktiven Track zuweisen. */
  setTrackProgram(programId: string): void {
    this.updateTrack(this.state.activeTrack, { programId });
    this.setCurrentProgram(programId);
  }

  updateSequence(fn: (seq: Sequence) => void): void {
    fn(this.currentSequence);
    this.emit({ kind: 'sequence', index: this.state.currentSeq });
  }

  updateTrack(index: number, patch: Partial<Track>): void {
    const t = this.currentSequence.tracks[index];
    if (!t) return;
    Object.assign(t, patch);
    this.emit({ kind: 'sequence', index: this.state.currentSeq });
  }

  updateSeqSettings(patch: Partial<SeqSettings>): void {
    Object.assign(this.state.seqSettings, patch);
    this.emit({ kind: 'seq-settings' });
  }

  setSolo(track: number | null): void {
    this.state.soloTrack = track;
    this.emit({ kind: 'seq-settings' });
  }

  /** Aufgenommene Events aus dem Worklet übernehmen (ohne Rückspiegelung). */
  applyEngineTrack(seqIndex: number, track: number, events: NoteEvent[], used: boolean): void {
    const t = this.state.sequences[seqIndex]?.tracks[track];
    if (!t) return;
    t.events = events;
    t.used = used || t.used;
    this.emit({ kind: 'sequence', index: seqIndex, fromEngine: true });
  }

  applyEngineBars(seqIndex: number, bars: TimeSig[]): void {
    const s = this.state.sequences[seqIndex];
    if (!s) return;
    s.bars = bars;
    this.emit({ kind: 'sequence', index: seqIndex, fromEngine: true });
  }

  // ---------- UNDO SEQ ----------

  /** Vor jeder Aufnahme: Zustand der Sequenz merken. */
  snapshotForUndo(): void {
    this.undoSnapshot = { index: this.state.currentSeq, seq: structuredClone(this.currentSequence) };
    this.undone = false;
  }

  /** UNDO-SEQ-LED: leuchtet, solange sich die letzte Aufnahme zurücknehmen lässt. */
  get undoLed(): boolean {
    return this.undoAvailable && !this.undone;
  }

  get undoAvailable(): boolean {
    return this.undoSnapshot !== null && this.undoSnapshot.index === this.state.currentSeq;
  }

  /** Handbuch: UNDO nimmt die letzte Aufnahme zurück; erneutes Drücken stellt sie wieder her. */
  undoSeq(): boolean {
    const snap = this.undoSnapshot;
    if (!snap || snap.index !== this.state.currentSeq) return false;
    const now = this.state.sequences[snap.index]!;
    this.state.sequences[snap.index] = snap.seq;
    this.undoSnapshot = { index: snap.index, seq: now };
    this.undone = !this.undone;
    this.emit({ kind: 'sequence', index: snap.index });
    return true;
  }
}
