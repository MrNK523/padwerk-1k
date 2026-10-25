import type { Store } from '../state/store';
import type { AudioEngine } from './audioEngine';

/**
 * Spiegelt Store-Inhalte ins AudioWorklet: beim Start alles, danach jede Änderung.
 * Änderungen werden pro Mikrotask gebündelt (Wheel-Drehungen erzeugen viele Änderungen).
 * Aufnahmen aus dem Worklet fließen umgekehrt zurück in den Store.
 */
export function syncEngine(store: Store, engine: AudioEngine): void {
  const pendingPrograms = new Set<string>();
  let pendingSequence = false;
  let pendingSettings = false;
  let scheduled = false;

  const sendSample = (id: string) => {
    const audio = store.sampleAudio(id);
    if (!audio) return;
    // Kopie übertragen – der Hauptthread behält seine Daten (Wellenform, Speichern)
    const channels = audio.channels.map((c) => c.slice());
    engine.send({ type: 'sample', id, sampleRate: audio.sampleRate, channels }, channels.map((c) => c.buffer));
  };
  const sendProgram = (id: string) => {
    const p = store.program(id);
    if (p) engine.send({ type: 'program', program: p });
  };
  const sendSequence = () => engine.send({ type: 'sequence', index: store.state.currentSeq, seq: store.currentSequence });
  const sendSettings = () => engine.send({
    type: 'seqSettings', settings: { ...store.state.seqSettings }, activeTrack: store.state.activeTrack, soloTrack: store.state.soloTrack,
  });

  const flush = () => {
    scheduled = false;
    for (const id of pendingPrograms) sendProgram(id);
    pendingPrograms.clear();
    if (pendingSequence) sendSequence();
    if (pendingSettings) sendSettings();
    pendingSequence = pendingSettings = false;
  };
  const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(flush); } };

  engine.onReady(() => {
    for (const s of store.state.samples) sendSample(s.id);
    for (const p of store.state.programs) sendProgram(p.id);
    sendSettings();
    sendSequence();
  });

  store.on((c) => {
    if (!engine.context) return; // vor dem Start: kommt mit der Erstbefüllung
    switch (c.kind) {
      case 'sample':
        if (c.removed) engine.send({ type: 'sampleRemove', id: c.id }); else sendSample(c.id);
        break;
      case 'program':
        if (c.removed) { engine.send({ type: 'programRemove', id: c.id }); return; }
        pendingPrograms.add(c.id);
        schedule();
        break;
      case 'sequence':
        if (c.fromEngine || c.index !== store.state.currentSeq) return;
        pendingSequence = true;
        schedule();
        break;
      case 'seq-settings':
        pendingSettings = true;
        schedule();
        break;
    }
  });

  engine.onMessage((m) => {
    if (m.type === 'track') store.applyEngineTrack(m.seqIndex, m.track, m.events, m.used);
    else if (m.type === 'bars') store.applyEngineBars(m.seqIndex, m.bars);
  });
}
