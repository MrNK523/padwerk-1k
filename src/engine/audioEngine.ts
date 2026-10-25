import processorUrl from './worklet/processor.ts?worker&url';
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from './protocol';

export interface LatencyInfo {
  sampleRate: number;
  /** Verarbeitungs-Latenz des Kontexts in ms (AudioContext.baseLatency). */
  baseMs: number | null;
  /** Ausgabe-Latenz in ms (AudioContext.outputLatency) – nicht in jedem Browser vorhanden. */
  outputMs: number | null;
  /** Ein Render-Block (128 Frames) in ms – Mindestverzögerung für Live-Pads. */
  blockMs: number;
}

export interface RoundTripResult {
  ok: boolean;
  ms?: number;
  peak: number;
  reason?: string;
}

type Listener = (msg: FromWorklet) => void;

/**
 * Brücke zwischen Hauptthread und AudioWorklet.
 * Der AudioContext entsteht erst nach einer Nutzergeste (Safari/iOS-Pflicht, „Audio-Unlock“).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private listeners = new Set<Listener>();
  private starting: Promise<void> | null = null;

  get running(): boolean {
    return this.ctx?.state === 'running' && this.node !== null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Muss aus einem Pointer-/Key-Handler aufgerufen werden. Mehrfachaufrufe sind harmlos. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    // resume() sofort in der Geste aufrufen – iOS verlangt das synchron zur Berührung.
    const resumed = this.ctx.resume();
    if (!this.node) {
      await this.ctx.audioWorklet.addModule(processorUrl);
      this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.port.onmessage = (ev: MessageEvent<FromWorklet>) => {
        for (const fn of this.listeners) fn(ev.data);
      };
      this.node.connect(this.ctx.destination);
    }
    await resumed;
  }

  onMessage(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(msg: ToWorklet): void {
    this.node?.port.postMessage(msg);
  }

  latency(): LatencyInfo | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const toMs = (s: number | undefined) => (typeof s === 'number' && Number.isFinite(s) ? s * 1000 : null);
    return {
      sampleRate: ctx.sampleRate,
      baseMs: toMs(ctx.baseLatency),
      outputMs: toMs((ctx as AudioContext & { outputLatency?: number }).outputLatency),
      blockMs: (128 / ctx.sampleRate) * 1000,
    };
  }

  /**
   * Round-Trip-Messung: Klick ausgeben, über Mikrofon/Line-in wieder erfassen.
   * Lautsprecher und Mikrofon brauchen dafür akustischen (oder Kabel-)Kontakt.
   */
  async measureRoundTrip(threshold = 0.2, timeoutMs = 1500): Promise<RoundTripResult> {
    await this.start();
    const ctx = this.ctx!;
    const node = this.node!;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = ctx.createMediaStreamSource(stream);
    src.connect(node);
    try {
      // kurz warten, bis Eingangssignal fließt
      await new Promise((r) => setTimeout(r, 300));
      const result = await new Promise<FromWorklet & { type: 'measureResult' }>((resolve) => {
        const off = this.onMessage((m) => {
          if (m.type === 'measureResult') { off(); resolve(m); }
        });
        this.send({ type: 'measureStart', threshold, timeoutFrames: Math.round((timeoutMs / 1000) * ctx.sampleRate) });
      });
      if (result.ok) return { ok: true, ms: (result.latencyFrames / ctx.sampleRate) * 1000, peak: result.peak };
      return { ok: false, peak: result.peak, reason: result.reason };
    } finally {
      src.disconnect();
      for (const t of stream.getTracks()) t.stop();
    }
  }
}
