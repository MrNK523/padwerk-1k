/**
 * Sampler-Kern: Stimmen, Pad-Logik und Mischung. Rein (keine Browser-API), läuft im AudioWorklet
 * und in Unit-Tests. Ein Aufruf von `render` füllt zwei Ausgabepuffer.
 */
import { layersFor, padsToCut, simultTargets } from '../core/padLogic';
import type { NoteVariation } from '../core/levels16';
import type { DrumProgram, Layer, PadParams } from '../core/model';
import { Adsr } from './envelope';
import { Svf } from './filter';
import {
  attackMs, cutoffHz, decayMs, EQ_HIGH_HZ, EQ_LOW_HZ, eqGain, levelGain, panGains, resoToQ, semitonesToRatio, veloGain,
} from './params';
import { MAX_VOICES } from './voicePool';

export interface SampleData {
  channels: Float32Array[];
  sampleRate: number;
}

/** Kurzer Ausblender beim Abschneiden (Mute-Gruppe, Mono, Stealing) gegen Knackser. */
const CUT_FADE_MS = 2;
/** NOTE ON mit Release 0: minimaler Ausklang gegen Knackser. */
const MIN_RELEASE_MS = 1.5;
const FILTER_UPDATE = 32;

function hermite(x0: number, x1: number, x2: number, x3: number, t: number): number {
  const c1 = 0.5 * (x2 - x0);
  const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
  const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
  return ((c3 * t + c2) * t + c1) * t + x1;
}

function readAt(buf: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const t = pos - i;
  const n = buf.length;
  const at = (k: number) => (k >= 0 && k < n ? buf[k]! : 0);
  return hermite(at(i - 1), at(i), at(i + 1), at(i + 2), t);
}

export class Voice {
  active = false;
  startFrame = 0;
  programId = '';
  pad = -1;
  private left: Float32Array | null = null;
  private right: Float32Array | null = null;
  private mixLR = false;
  private pos = 0;
  private inc = 1;
  private end = 0;
  private gainL = 1;
  private gainR = 1;
  private readonly amp = new Adsr();
  private readonly fenv = new Adsr();
  private readonly svfL = new Svf();
  private readonly svfR = new Svf();
  private filterOn = false;
  private filterBase = 100;
  private filterAmount = 0;
  private filterQ = 0.707;
  private filterCounter = 0;
  private oneShot = true;
  /** ONE SHOT: ab dieser Restlänge (Quell-Frames) beginnt der Release. 0 = aus. */
  private releaseTail = 0;
  private released = false;
  private cutLeft = 0;
  private cutTotal = 0;
  private sr = 48000;

  start(args: {
    frame: number; programId: string; pad: number; params: PadParams; layer: Layer; sample: SampleData;
    velocity: number; variation: NoteVariation; sampleRate: number;
  }): void {
    const { params: p, layer, sample, variation: v, sampleRate } = args;
    this.sr = sampleRate;
    this.active = true;
    this.startFrame = args.frame;
    this.programId = args.programId;
    this.pad = args.pad;
    this.released = false;
    this.cutLeft = 0;
    const [ch0, ch1] = sample.channels;
    if (!ch0) { this.active = false; return; }
    const stereo = !!ch1 && ch1.length === ch0.length;
    if (!stereo || layer.sound === 'ST') { this.left = ch0; this.right = stereo ? ch1! : ch0; this.mixLR = false; }
    else if (layer.sound === 'L') { this.left = ch0; this.right = ch0; this.mixLR = false; }
    else if (layer.sound === 'R') { this.left = ch1!; this.right = ch1!; this.mixLR = false; }
    else { this.left = ch0; this.right = ch1!; this.mixLR = true; }

    const frames = ch0.length;
    const ratio = (sample.sampleRate / sampleRate) * semitonesToRatio(layer.tune + (v.tune ?? 0));
    const rev = layer.dir === 'REV';
    this.inc = rev ? -ratio : ratio;
    this.pos = rev ? frames - 1 : 0;
    this.end = frames;

    const velocity = v.velocity ?? args.velocity;
    const g = levelGain(layer.level) * levelGain(p.mixLevel) * veloGain(p.velo, velocity);
    const [pl, pr] = panGains(p.pan);
    this.gainL = g * pl;
    this.gainR = g * pr;

    this.oneShot = p.playMode === 'ONE_SHOT';
    const relFrames = Math.max((MIN_RELEASE_MS / 1000) * sampleRate, (decayMs(p.amp.release) / 1000) * sampleRate);
    const a = v.attack ?? p.amp.attack;
    const d = v.decay ?? p.amp.decay;
    this.amp.level = 0;
    this.amp.trigger({
      attackFrames: (attackMs(a) / 1000) * sampleRate,
      decayFrames: (decayMs(d) / 1000) * sampleRate,
      sustain: p.amp.sustain / 100,
      releaseFrames: relFrames,
    });
    // ONE SHOT: Release blendet zum Sample-Ende hin aus (JJOS2XL: „Release works“ bei ONE SHOT)
    // Ausblendlänge in Sample-Frames der Quelle (berücksichtigt Tonhöhe)
    const relSrcFrames = p.amp.release > 0 ? (decayMs(p.amp.release) / 1000) * sampleRate * ratio : 0;
    this.releaseTail = this.oneShot ? relSrcFrames : 0;

    this.setupFilter(p, velocity, v);
  }

  private setupFilter(p: PadParams, velocity: number, v: NoteVariation): void {
    this.filterOn = p.filterType !== 'OFF';
    if (!this.filterOn) return;
    this.svfL.reset();
    this.svfR.reset();
    if (p.filterType === 'EQL' || p.filterType === 'EQH') {
      for (const f of [this.svfL, this.svfR]) {
        f.mode = p.filterType === 'EQL' ? 'LS' : 'HS';
        f.shelfGain = eqGain(p.filterFreq);
        f.setParams(p.filterType === 'EQL' ? EQ_LOW_HZ : EQ_HIGH_HZ, 0.707, this.sr);
      }
      this.filterAmount = 0;
      return;
    }
    const mode = p.filterType === 'LPF' ? 'LP' : p.filterType === 'BPF' ? 'BP' : 'HP';
    this.svfL.mode = mode;
    this.svfR.mode = mode;
    this.filterBase = v.filterFreq ?? p.filterFreq;
    this.filterQ = resoToQ(p.filterReso);
    // JJOS2XL: Velocity wird zur ADSR-Tiefe addiert (VELO 100 → +1…100)
    this.filterAmount = Math.min(100, p.filterDepth + (p.filterVelo * velocity) / 127);
    this.fenv.level = 0;
    this.fenv.trigger({
      attackFrames: (attackMs(p.filterEnv.attack) / 1000) * this.sr,
      decayFrames: (decayMs(p.filterEnv.decay) / 1000) * this.sr,
      sustain: p.filterEnv.sustain / 100,
      releaseFrames: Math.max(1, (decayMs(p.filterEnv.release) / 1000) * this.sr),
    });
    this.filterCounter = 0;
    this.updateFilter(0);
  }

  private updateFilter(env: number): void {
    const value = Math.min(100, Math.max(0, this.filterBase + this.filterAmount * env));
    const hz = cutoffHz(value);
    this.svfL.setParams(hz, this.filterQ, this.sr);
    this.svfR.setParams(hz, this.filterQ, this.sr);
  }

  /** Pad losgelassen (wirkt nur bei NOTE ON). */
  noteOff(): void {
    if (!this.active || this.oneShot || this.released) return;
    this.released = true;
    this.amp.release();
    this.fenv.release();
  }

  /** Schnell ausblenden und freigeben. */
  cut(): void {
    if (!this.active || this.cutLeft > 0) return;
    this.cutTotal = Math.max(1, Math.round((CUT_FADE_MS / 1000) * this.sr));
    this.cutLeft = this.cutTotal;
  }

  render(outL: Float32Array, outR: Float32Array, n: number): void {
    if (!this.active || !this.left || !this.right) return;
    const L = this.left;
    const R = this.right;
    for (let i = 0; i < n; i++) {
      if (this.pos < 0 || this.pos >= this.end) { this.active = false; return; }
      if (!this.released && this.releaseTail > 0) {
        const remaining = this.inc > 0 ? this.end - this.pos : this.pos + 1;
        if (remaining <= this.releaseTail) { this.released = true; this.amp.release(); }
      }
      let env = this.amp.next();
      if (this.amp.done) { this.active = false; return; }
      if (this.cutLeft > 0) {
        env *= this.cutLeft / this.cutTotal;
        if (--this.cutLeft === 0) { this.active = false; return; }
      }
      let l = readAt(L, this.pos);
      let r = L === R ? l : readAt(R, this.pos);
      if (this.mixLR) { l = r = (l + r) * 0.5; }
      if (this.filterOn) {
        if (this.filterAmount !== 0) {
          const fe = this.fenv.next();
          if (++this.filterCounter >= FILTER_UPDATE) { this.filterCounter = 0; this.updateFilter(fe); }
        }
        l = this.svfL.process(l);
        r = this.svfR.process(r);
      }
      outL[i]! += l * env * this.gainL;
      outR[i]! += r * env * this.gainR;
      this.pos += this.inc;
    }
  }
}

/** Weicher Begrenzer auf der Summe: bis 0,8 linear, darüber sanft gegen 1. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.8) return x;
  return Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
}

export class SamplerCore {
  readonly voices: Voice[] = Array.from({ length: MAX_VOICES }, () => new Voice());
  private programs = new Map<string, DrumProgram>();
  private samples = new Map<string, SampleData>();
  private frame = 0;

  constructor(public sampleRate: number) {}

  setProgram(p: DrumProgram): void { this.programs.set(p.id, p); }
  removeProgram(id: string): void { this.programs.delete(id); }
  setSample(id: string, s: SampleData): void { this.samples.set(id, s); }
  removeSample(id: string): void {
    this.samples.delete(id);
    for (const v of this.voices) if (v.active) v.cut();
  }

  get activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  padOn(programId: string, pad: number, velocity: number, variation: NoteVariation = {}, depth = 0): void {
    const program = this.programs.get(programId);
    const params = program?.pads[pad];
    if (!program || !params) return;
    for (const c of padsToCut(program, pad)) this.cutPad(programId, c);
    const layerVel = variation.layerVelocity ?? variation.velocity ?? velocity;
    for (const { layer } of layersFor(params, layerVel)) {
      const sample = layer.sampleId ? this.samples.get(layer.sampleId) : undefined;
      if (!sample) continue;
      const v = this.allocate();
      v.start({ frame: this.frame, programId, pad, params, layer, sample, velocity, variation, sampleRate: this.sampleRate });
    }
    if (depth === 0) for (const t of simultTargets(program, pad)) this.padOn(programId, t, velocity, variation, 1);
  }

  padOff(programId: string, pad: number): void {
    const program = this.programs.get(programId);
    for (const v of this.voices) if (v.active && v.programId === programId && v.pad === pad) v.noteOff();
    if (program) for (const t of simultTargets(program, pad)) {
      for (const v of this.voices) if (v.active && v.programId === programId && v.pad === t) v.noteOff();
    }
  }

  allSoundOff(): void {
    for (const v of this.voices) v.cut();
  }

  private cutPad(programId: string, pad: number): void {
    for (const v of this.voices) if (v.active && v.programId === programId && v.pad === pad) v.cut();
  }

  /** Freie Stimme, sonst die älteste (ANNAHME A-05). */
  private allocate(): Voice {
    let oldest = this.voices[0]!;
    for (const v of this.voices) {
      if (!v.active) return v;
      if (v.startFrame < oldest.startFrame) oldest = v;
    }
    return oldest;
  }

  render(outL: Float32Array, outR: Float32Array, n: number): void {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    for (const v of this.voices) if (v.active) v.render(outL, outR, n);
    for (let i = 0; i < n; i++) {
      outL[i] = softClip(outL[i]!);
      outR[i] = softClip(outR[i]!);
    }
    this.frame += n;
  }
}
