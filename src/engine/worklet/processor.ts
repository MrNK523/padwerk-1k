/**
 * Padwerk-Engine (AudioWorklet) – dünne Hülle um den reinen Engine-Kern.
 */
import { EngineCore } from '../engineCore';
import { PROCESSOR_NAME, type ToWorklet } from '../protocol';

class PadwerkProcessor extends AudioWorkletProcessor {
  private core = new EngineCore(sampleRate, (msg) => this.port.postMessage(msg));
  private spare = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<ToWorklet>) => this.core.handle(ev.data);
    this.port.postMessage({ type: 'ready', sampleRate });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0]!;
    if (this.spare.length !== left.length) this.spare = new Float32Array(left.length);
    const right = out[1] ?? this.spare;
    this.core.process(left, right, left.length, inputs[0]?.[0]);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PadwerkProcessor);
