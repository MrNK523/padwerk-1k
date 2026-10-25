import {
  type DrumProgram, type Layer, type PadParams, type SampleMeta,
  MAX_PROGRAMS, newDrumProgram, sanitizeName, uniqueName,
} from '../core/model';

/** Audiodaten liegen getrennt von den (serialisierbaren) Metadaten. */
export interface SampleAudio {
  /** 1 oder 2 Kanäle, gleiche Länge */
  channels: Float32Array[];
  sampleRate: number;
}

export type Change =
  | { kind: 'sample'; id: string; removed?: boolean }
  | { kind: 'program'; id: string; removed?: boolean }
  | { kind: 'current-program'; id: string };

export type ChangeListener = (c: Change) => void;

export interface ProjectState {
  samples: SampleMeta[];
  programs: DrumProgram[];
  currentProgramId: string;
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
    this.state = { samples: [], programs: [first], currentProgramId: first.id };
  }

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
  addSample(rawName: string, audio: SampleAudio, rootNote = 60): SampleMeta {
    const name = uniqueName(sanitizeName(rawName), this.state.samples.map((s) => s.name));
    const ch = audio.channels.slice(0, 2);
    const meta: SampleMeta = {
      id: this.id('s'),
      name,
      sampleRate: audio.sampleRate,
      channels: ch.length === 2 ? 2 : 1,
      frames: ch[0]?.length ?? 0,
      rootNote,
    };
    this.audio.set(meta.id, { channels: ch, sampleRate: audio.sampleRate });
    this.state.samples.push(meta);
    this.emit({ kind: 'sample', id: meta.id });
    return meta;
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
}
