import type { Store } from '../state/store';
import type { AudioEngine } from './audioEngine';

/**
 * Spiegelt Store-Inhalte ins AudioWorklet: beim Start alles, danach jede Änderung.
 * Program-Änderungen werden pro Mikrotask gebündelt (Wheel-Drehungen erzeugen viele Änderungen).
 */
export function syncEngine(store: Store, engine: AudioEngine): void {
  const pendingPrograms = new Set<string>();
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

  const flush = () => {
    scheduled = false;
    for (const id of pendingPrograms) sendProgram(id);
    pendingPrograms.clear();
  };

  engine.onReady(() => {
    for (const s of store.state.samples) sendSample(s.id);
    for (const p of store.state.programs) sendProgram(p.id);
  });

  store.on((c) => {
    if (!engine.running && !engine.context) return; // vor dem Start: kommt mit der Erstbefüllung
    if (c.kind === 'sample') {
      if (c.removed) engine.send({ type: 'sampleRemove', id: c.id });
      else sendSample(c.id);
    } else if (c.kind === 'program') {
      if (c.removed) { engine.send({ type: 'programRemove', id: c.id }); return; }
      pendingPrograms.add(c.id);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    }
  });
}
