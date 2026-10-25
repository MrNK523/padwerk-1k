import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { AudioEngine } from './engine/audioEngine';
import { padToNote } from './engine/protocol';
import { HwBus, type ButtonId } from './input/events';
import { attachKeyboard } from './input/keyboardInput';
import { applyFullLevel } from './input/velocity';
import { FrameBuffer } from './ui/display/framebuffer';
import { LcdRenderer } from './ui/display/lcdRenderer';
import { Panel } from './ui/panel/panel';
import { DiagScreen, initialDiagState } from './ui/screens/diagScreen';

const app = document.getElementById('app')!;
const bus = new HwBus();
const engine = new AudioEngine();
const panel = new Panel(app, bus);
const fb = new FrameBuffer();
const lcd = new LcdRenderer(panel.els.lcd, fb);
const state = initialDiagState();
let dirty = true;
const touch = () => { dirty = true; };

// ---------- Audio-Start (Unlock) ----------
const overlay = document.getElementById('unlock')!;
async function unlock(): Promise<void> {
  if (engine.running) return;
  state.audio = 'startet';
  touch();
  try {
    await engine.start();
    const l = engine.latency();
    state.audio = 'läuft';
    if (l) {
      state.sampleRate = l.sampleRate;
      state.baseMs = l.baseMs;
      state.outputMs = l.outputMs;
      state.blockMs = l.blockMs;
    }
    overlay.hidden = true;
  } catch (err) {
    state.audio = 'Fehler';
    state.message = String((err as Error).message ?? err).slice(0, 30);
    console.error(err);
  }
  touch();
}
// Jede erste Berührung/Taste startet Audio – das Overlay ist nur der sichtbare Hinweis.
window.addEventListener('pointerdown', () => void unlock(), { capture: true });
overlay.addEventListener('click', () => void unlock());

// Ausgabelatenz ist in manchen Browsern erst nach einigen Blöcken bekannt → regelmäßig nachlesen
setInterval(() => {
  if (!engine.running) return;
  const l = engine.latency();
  if (l && (l.outputMs !== state.outputMs || l.baseMs !== state.baseMs)) {
    state.outputMs = l.outputMs;
    state.baseMs = l.baseMs;
    touch();
  }
  engine.send({ type: 'statusRequest' });
}, 250);

engine.onMessage((m) => {
  if (m.type === 'status' && m.activeVoices !== state.voices) {
    state.voices = m.activeVoices;
    touch();
  }
});

// ---------- Screen ----------
const screen = new DiagScreen(state, {
  measure: () => void measure(),
  allSoundOff: () => engine.send({ type: 'allSoundOff' }),
});

async function measure(): Promise<void> {
  state.message = 'Messe ... Lautsprecher an';
  touch();
  try {
    const r = await engine.measureRoundTrip();
    if (r.ok && r.ms !== undefined) {
      state.roundTripMs = r.ms;
      state.message = 'Messung ok';
    } else {
      state.message = `kein Klick erkannt (${(r.peak * 100).toFixed(0)}%)`;
    }
  } catch (err) {
    state.message = 'Mikrofon nicht erlaubt';
    console.warn(err);
  }
  touch();
}

// ---------- Ereignisverarbeitung ----------
const BANK_OF: Partial<Record<ButtonId, 0 | 1 | 2 | 3>> = { BANK_A: 0, BANK_B: 1, BANK_C: 2, BANK_D: 3 };
let stopTaps: number[] = [];

function updateLeds(): void {
  (['BANK_A', 'BANK_B', 'BANK_C', 'BANK_D'] as const).forEach((id, i) => panel.setLed(id, state.bank === i));
  panel.setLed('FULL_LEVEL', state.fullLevel);
}
updateLeds();

bus.on((e) => {
  if (e.source === 'keyboard') void unlock();
  if (screen.onEvent(e)) { touch(); return; }

  switch (e.kind) {
    case 'pad': {
      const name = `${'ABCD'[state.bank]}${String(e.pad + 1).padStart(2, '0')}`;
      if (e.down) {
        const velocity = applyFullLevel(e.velocity, state.fullLevel);
        engine.send({ type: 'padOn', note: padToNote(state.bank, e.pad), velocity });
        state.lastPad = name;
        state.lastVelocity = velocity;
        if (e.source === 'keyboard') panel.flashPad(e.pad, velocity);
      } else {
        engine.send({ type: 'padOff', note: padToNote(state.bank, e.pad) });
        if (e.source === 'keyboard') panel.releasePadVisual(e.pad);
      }
      break;
    }
    case 'button': {
      if (e.source !== 'touch' && e.source !== 'mouse') panel.setPressed(e.id, e.down);
      if (!e.down) break;
      state.lastButton = e.id;
      const bank = BANK_OF[e.id];
      if (bank !== undefined) state.bank = bank;
      if (e.id === 'FULL_LEVEL') state.fullLevel = !state.fullLevel;
      if (e.id === 'STOP') {
        // Original: STOP dreimal schnell = alle Klänge aus
        const now = performance.now();
        stopTaps = [...stopTaps.filter((t) => now - t < 600), now];
        if (stopTaps.length >= 3) { engine.send({ type: 'allSoundOff' }); stopTaps = []; state.message = 'Alle Klänge aus'; }
      }
      updateLeds();
      break;
    }
    case 'wheel':
      state.wheel += e.delta;
      break;
    case 'slider':
      state.sliders[e.slider] = e.value;
      break;
  }
  touch();
});

attachKeyboard(window, bus);

// ---------- Zeichnen ----------
const frame = () => {
  if (dirty) {
    screen.render(fb);
    dirty = false;
  }
  lcd.render();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
new ResizeObserver(() => { lcd.resize(); lcd.render(true); }).observe(panel.els.lcd);

// ---------- Offline-Fähigkeit ----------
if (import.meta.env.PROD) registerSW({ immediate: true });

// Für Browser-Tests
(window as unknown as { __padwerk: unknown }).__padwerk = { bus, engine, state, fb };
