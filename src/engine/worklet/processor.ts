/**
 * Padwerk-Engine (AudioWorklet).
 * M0: Testklang pro Pad über den 32-Stimmen-Pool, Round-Trip-Latenzmessung.
 * Ab M1 ersetzt der Sampler den Testklang; ab M2 läuft hier der Sequencer.
 */
import { allocateVoice, countActive, createSlots, type VoiceSlot } from '../../dsp/voicePool';
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from '../protocol';

interface TestVoice extends VoiceSlot {
  note: number;
  phase: number;
  freq: number;
  level: number; // aktueller Hüllkurvenwert
  target: number; // Spitzenpegel aus Velocity
  attackLeft: number; // verbleibende Attack-Frames
  decayMul: number; // Multiplikator pro Frame
}

const CLICK_FRAMES = 32;

class PadwerkProcessor extends AudioWorkletProcessor {
  private voices: TestVoice[];
  private frame = 0;
  private measure: {
    armed: boolean;
    emitFrame: number;
    clickLeft: number;
    threshold: number;
    deadline: number;
    peak: number;
  } | null = null;

  constructor() {
    super();
    this.voices = createSlots().map((s) => ({
      ...s, note: -1, phase: 0, freq: 0, level: 0, target: 0, attackLeft: 0, decayMul: 1,
    }));
    this.port.onmessage = (ev: MessageEvent<ToWorklet>) => this.onMessage(ev.data);
    this.post({ type: 'ready', sampleRate });
  }

  private post(msg: FromWorklet): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: ToWorklet): void {
    switch (msg.type) {
      case 'padOn': this.noteOn(msg.note, msg.velocity); break;
      case 'padOff': break; // Testklang ist One-Shot
      case 'allSoundOff': for (const v of this.voices) { v.active = false; v.level = 0; } break;
      case 'measureStart':
        this.measure = { armed: true, emitFrame: -1, clickLeft: CLICK_FRAMES, threshold: msg.threshold,
          deadline: this.frame + msg.timeoutFrames, peak: 0 };
        break;
      case 'statusRequest':
        this.post({ type: 'status', activeVoices: countActive(this.voices), frame: this.frame });
        break;
    }
  }

  private noteOn(note: number, velocity: number): void {
    const { index, stolen } = allocateVoice(this.voices);
    const v = this.voices[index]!;
    v.active = true;
    v.startFrame = this.frame;
    v.note = note;
    v.freq = 110 * Math.pow(2, (note - 36) / 12);
    if (!stolen) { v.phase = 0; v.level = 0; }
    const vel = Math.max(1, Math.min(127, velocity)) / 127;
    v.target = 0.35 * vel * vel;
    v.attackLeft = Math.max(1, Math.round(sampleRate * 0.002));
    v.decayMul = Math.exp(-1 / (sampleRate * 0.25)); // ~250 ms Abklingzeit
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0]!;
    const right = out[1] ?? left;
    const n = left.length;
    left.fill(0);
    if (right !== left) right.fill(0);

    const twoPiOverSr = (2 * Math.PI) / sampleRate;
    for (const v of this.voices) {
      if (!v.active) continue;
      const inc = v.freq * twoPiOverSr;
      for (let i = 0; i < n; i++) {
        if (v.attackLeft > 0) {
          v.level += (v.target - v.level) / v.attackLeft;
          v.attackLeft--;
        } else {
          v.level *= v.decayMul;
        }
        const s = Math.sin(v.phase) * v.level;
        v.phase += inc;
        if (v.phase > 2 * Math.PI) v.phase -= 2 * Math.PI;
        left[i]! += s;
        if (right !== left) right[i]! += s;
      }
      if (v.attackLeft === 0 && v.level < 1e-4) v.active = false;
    }

    this.processMeasure(inputs[0]?.[0], left, right, n);
    this.frame += n;
    return true;
  }

  private processMeasure(input: Float32Array | undefined, left: Float32Array, right: Float32Array, n: number): void {
    const m = this.measure;
    if (!m) return;
    if (m.armed && m.emitFrame < 0) m.emitFrame = this.frame; // Klick beginnt mit diesem Block
    for (let i = 0; i < n; i++) {
      if (m.clickLeft > 0) {
        const s = (m.clickLeft % 8 < 4) ? 0.9 : -0.9;
        left[i] = s;
        if (right !== left) right[i] = s;
        m.clickLeft--;
      }
      const x = input ? Math.abs(input[i] ?? 0) : 0;
      if (x > m.peak) m.peak = x;
      const f = this.frame + i;
      if (f > m.emitFrame + 8 && x >= m.threshold) {
        this.post({ type: 'measureResult', ok: true, latencyFrames: f - m.emitFrame, peak: m.peak });
        this.measure = null;
        return;
      }
    }
    if (this.frame + n >= m.deadline) {
      this.post({ type: 'measureResult', ok: false, reason: 'timeout', peak: m.peak });
      this.measure = null;
    }
  }
}

registerProcessor(PROCESSOR_NAME, PadwerkProcessor);
