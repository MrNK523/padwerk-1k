/**
 * Engine-Kern: verbindet Sequencer und Sampler, verarbeitet Nachrichten und rendert Blöcke.
 * Rein (keine Browser-API) – der AudioWorklet-Prozessor ist nur eine dünne Hülle darum,
 * damit sich das Zusammenspiel unter Node testen lässt.
 */
import { SequencerCore, type SeqOutput } from '../core/sequencerCore';
import { SamplerCore } from '../dsp/sampler';
import type { FromWorklet, ToWorklet } from './protocol';

const CLICK_FRAMES = 32;
/** Position etwa alle 4 Blöcke melden (~11 ms bei 48 kHz) – genug für flüssige Anzeige. */
const POS_EVERY = 4;
/** Geänderte Tracks etwa alle 16 Blöcke zurückmelden (~43 ms). */
const TRACKS_EVERY = 16;

interface Action { offset: number; order: number; run: () => void }

export class EngineCore {
  readonly sampler: SamplerCore;
  readonly seq: SequencerCore;
  private seqIndex = 0;
  private frame = 0;
  private blocks = 0;
  private wasRunning = false;
  private actions: Action[] = [];
  private actionOrder = 0;
  private measure: { emitFrame: number; clickLeft: number; threshold: number; deadline: number; peak: number } | null = null;
  private readonly out: SeqOutput;

  constructor(readonly sampleRate: number, private post: (msg: FromWorklet) => void) {
    this.sampler = new SamplerCore(sampleRate);
    this.seq = new SequencerCore(sampleRate);
    const push = (offset: number, run: () => void) => this.actions.push({ offset, order: this.actionOrder++, run });
    this.out = {
      noteOn: (o, programId, pad, velocity, variation) => push(o, () => this.sampler.padOn(programId, pad, velocity, variation)),
      noteOff: (o, programId, pad) => push(o, () => this.sampler.padOff(programId, pad)),
      click: (o, accent) => push(o, () => this.sampler.triggerClick(accent, this.seq.settings.clickLevel)),
    };
  }

  handle(msg: ToWorklet): void {
    const s = this.sampler;
    const q = this.seq;
    switch (msg.type) {
      case 'sample': s.setSample(msg.id, { channels: msg.channels, sampleRate: msg.sampleRate, play: msg.play }); break;
      case 'sampleMeta': s.setSamplePlay(msg.id, msg.play); break;
      case 'audition': s.audition(msg.sampleId, msg.region, { gate: msg.gate, reverse: msg.reverse, velocity: msg.velocity }); break;
      case 'auditionOff': s.auditionOff(msg.cut); break;
      case 'sampleRemove': s.removeSample(msg.id); break;
      case 'program': s.setProgram(msg.program); break;
      case 'programRemove': s.removeProgram(msg.id); break;
      case 'padOn':
        s.padOn(msg.programId, msg.pad, msg.velocity, msg.variation);
        if (msg.live) q.recordNoteOn(msg.pad, msg.velocity, msg.variation);
        break;
      case 'padOff':
        s.padOff(msg.programId, msg.pad);
        if (msg.live) q.recordNoteOff(msg.pad);
        break;
      case 'repeatOn': q.repeatOn(msg.programId, msg.pad, msg.velocity, msg.variation); break;
      case 'repeatOff': q.repeatOff(msg.pad); break;
      case 'erasePads': q.setErasePads(msg.pads); break;
      case 'sequence':
        if (msg.index !== this.seqIndex && q.running) q.stop();
        this.seqIndex = msg.index;
        q.setSequence(msg.seq);
        break;
      case 'seqSettings':
        q.settings = msg.settings;
        q.activeTrack = msg.activeTrack;
        q.soloTrack = msg.soloTrack;
        break;
      case 'transport': this.transport(msg); break;
      case 'allSoundOff': s.allSoundOff(); break;
      case 'measureStart':
        this.measure = { emitFrame: -1, clickLeft: CLICK_FRAMES, threshold: msg.threshold, deadline: this.frame + msg.timeoutFrames, peak: 0 };
        break;
      case 'statusRequest':
        this.post({ type: 'status', activeVoices: s.activeVoices, frame: this.frame });
        break;
    }
  }

  private transport(msg: ToWorklet & { type: 'transport' }): void {
    const q = this.seq;
    switch (msg.cmd) {
      case 'playStart': q.playStart(msg.fromBar1); break;
      case 'play': q.play(); break;
      case 'record': q.record(msg.mode, msg.fromStart); break;
      case 'wait': q.waitForKey(msg.mode); break;
      case 'punchIn': q.punchIn(msg.mode); break;
      case 'punchOut': q.punchOut(); break;
      case 'locate': q.locate(msg.tick); break;
      case 'fix': q.fixTiming(); break;
      case 'stop':
        q.stop();
        q.flushOffs(this.out);
        for (const a of this.actions.splice(0)) a.run(); // Note-Offs sofort
        break;
    }
    this.postPos();
    this.postTracks();
  }

  /** Einen Audioblock rendern; `input` nur für die Latenzmessung. */
  process(left: Float32Array, right: Float32Array, n: number, input?: Float32Array): void {
    this.actions.length = 0;
    this.actionOrder = 0;
    this.seq.process(n, this.out);
    // Ereignisse sample-genau: Sampler bis zum Ereignis rendern, Ereignis ausführen, weiter
    this.actions.sort((a, b) => a.offset - b.offset || a.order - b.order);
    this.sampler.beginBlock(left, right, n);
    let pos = 0;
    for (const a of this.actions) {
      const at = Math.min(n, Math.max(pos, a.offset));
      this.sampler.renderRange(left, right, pos, at);
      a.run();
      pos = at;
    }
    this.sampler.renderRange(left, right, pos, n);
    this.sampler.endBlock(left, right, n);
    this.actions.length = 0;

    this.processMeasure(input, left, right, n);
    this.frame += n;
    this.blocks++;

    const running = this.seq.running || this.seq.state === 'waiting';
    if (running && this.blocks % POS_EVERY === 0) this.postPos();
    if (this.blocks % TRACKS_EVERY === 0) this.postTracks();
    if (this.wasRunning && !running) { this.postPos(); this.postTracks(); } // am Sequenzende gestoppt
    this.wasRunning = running;
  }

  private postPos(): void {
    this.post({ type: 'pos', tick: this.seq.position, state: this.seq.state, recMode: this.seq.recMode, seqIndex: this.seqIndex });
  }

  private postTracks(): void {
    const seq = this.seq.seq;
    if (!seq) return;
    for (const t of this.seq.dirtyTracks) {
      const tr = seq.tracks[t];
      if (tr) this.post({ type: 'track', seqIndex: this.seqIndex, track: t, events: tr.events, used: tr.used });
    }
    this.seq.dirtyTracks.clear();
    if (this.seq.barsChanged && !this.seq.running) {
      this.post({ type: 'bars', seqIndex: this.seqIndex, bars: seq.bars });
      this.seq.barsChanged = false;
    }
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
