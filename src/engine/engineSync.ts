import type { Store } from '../state/store';
import type { AudioEngine } from './audioEngine';

/**
 * Spiegelt Store-Inhalte ins AudioWorklet: beim Start alles, danach jede Änderung.
 * Änderungen werden pro Mikrotask gebündelt (Wheel-Drehungen erzeugen viele Änderungen).
 * Aufnahmen aus dem Worklet fließen umgekehrt zurück in den Store.
 */
export function syncEngine(store: Store, engine: AudioEngine): void {
  const pendingPrograms = new Set<string>();
  const pendingMeta = new Set<string>();
  // was das Worklet gerade kennt – nach „Projekt ersetzt“ wird es geleert
  const sentSamples = new Set<string>();
  const sentPrograms = new Set<string>();
  let pendingSequence = false;
  let pendingSettings = false;
  let scheduled = false;

  const sendSample = (id: string) => {
    const audio = store.sampleAudio(id);
    if (!audio) return;
    sentSamples.add(id);
    // Kopie übertragen – der Hauptthread behält seine Daten (Wellenform, Speichern)
    const channels = audio.channels.map((c) => c.slice());
    engine.send({ type: 'sample', id, sampleRate: audio.sampleRate, channels, play: playOf(id) }, channels.map((c) => c.buffer));
  };
  const playOf = (id: string) => {
    const m = store.sample(id);
    if (!m) return undefined;
    const { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops } = m;
    return { start, end, loopOn, loopPoint, loopMode, loopLock, chopOn, chops: chops.map((r) => ({ ...r })) };
  };
  const sendProgram = (id: string) => {
    const p = store.program(id);
    if (p) { engine.send({ type: 'program', program: p }); sentPrograms.add(id); }
  };
  const sendSequence = () => engine.send({ type: 'sequence', index: store.state.currentSeq, seq: store.currentSequence });
  const sendSettings = () => engine.send({
    type: 'seqSettings', settings: { ...store.state.seqSettings }, activeTrack: store.state.activeTrack, soloTrack: store.state.soloTrack,
  });

  const flush = () => {
    scheduled = false;
    for (const id of pendingPrograms) sendProgram(id);
    pendingPrograms.clear();
    for (const id of pendingMeta) { const play = playOf(id); if (play) engine.send({ type: 'sampleMeta', id, play }); }
    pendingMeta.clear();
    if (pendingSequence) sendSequence();
    if (pendingSettings) sendSettings();
    pendingSequence = pendingSettings = false;
  };
  const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(flush); } };

  const sendAll = () => {
    for (const s of store.state.samples) sendSample(s.id);
    for (const p of store.state.programs) sendProgram(p.id);
    sendSettings();
    sendSequence();
  };
  engine.onReady(sendAll);

  store.on((c) => {
    if (!engine.context) return; // vor dem Start: kommt mit der Erstbefüllung
    switch (c.kind) {
      case 'sample':
        if (c.removed) { engine.send({ type: 'sampleRemove', id: c.id }); sentSamples.delete(c.id); } else sendSample(c.id);
        break;
      case 'project':
        engine.send({ type: 'transport', cmd: 'stop' });
        engine.send({ type: 'allSoundOff' });
        for (const id of sentSamples) engine.send({ type: 'sampleRemove', id });
        for (const id of sentPrograms) engine.send({ type: 'programRemove', id });
        sentSamples.clear();
        sentPrograms.clear();
        pendingPrograms.clear();
        pendingMeta.clear();
        sendAll();
        break;
      case 'sample-meta':
        pendingMeta.add(c.id);
        schedule();
        break;
      case 'program':
        if (c.removed) { engine.send({ type: 'programRemove', id: c.id }); sentPrograms.delete(c.id); return; }
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
