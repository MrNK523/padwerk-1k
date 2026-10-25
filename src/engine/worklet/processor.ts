/**
 * Padwerk-Engine (AudioWorklet). Delegiert an den reinen Sampler-Kern.
 * Ab M2 läuft hier zusätzlich der Sequencer.
 */
import { SamplerCore } from '../../dsp/sampler';
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from '../protocol';

const CLICK_FRAMES = 32;

class PadwerkProcessor extends AudioWorkletProcessor {
  private core = new SamplerCore(sampleRate);
  private frame = 0;
  private measure: {
    emitFrame: number;
    clickLeft: number;
    threshold: number;
    deadline: number;
    peak: number;
  } | null = null;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<ToWorklet>) => this.onMessage(ev.data);
    this.post({ type: 'ready', sampleRate });
  }

  private post(msg: FromWorklet): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: ToWorklet): void {
    const c = this.core;
    switch (msg.type) {
      case 'sample': c.setSample(msg.id, { channels: msg.channels, sampleRate: msg.sampleRate }); break;
      case 'sampleRemove': c.removeSample(msg.id); break;
      case 'program': c.setProgram(msg.program); break;
      case 'programRemove': c.removeProgram(msg.id); break;
      case 'padOn': c.padOn(msg.programId, msg.pad, msg.velocity, msg.variation); break;
      case 'padOff': c.padOff(msg.programId, msg.pad); break;
      case 'allSoundOff': c.allSoundOff(); break;
      case 'measureStart':
        this.measure = { emitFrame: -1, clickLeft: CLICK_FRAMES, threshold: msg.threshold,
          deadline: this.frame + msg.timeoutFrames, peak: 0 };
        break;
      case 'statusRequest':
        this.post({ type: 'status', activeVoices: c.activeVoices, frame: this.frame });
        break;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0]!;
    const right = out[1] ?? new Float32Array(left.length);
    const n = left.length;
    this.core.render(left, right, n);
    this.processMeasure(inputs[0]?.[0], left, right, n);
    this.frame += n;
    return true;
  }

  private processMeasure(input: Float32Array | undefined, left: Float32Array, right: Float32Array, n: number): void {
    const m = this.measure;
    if (!m) return;
    if (m.emitFrame < 0) m.emitFrame = this.frame; // Klick beginnt mit diesem Block
    for (let i = 0; i < n; i++) {
      if (m.clickLeft > 0) {
        const s = m.clickLeft % 8 < 4 ? 0.9 : -0.9;
        left[i] = s;
        right[i] = s;
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
