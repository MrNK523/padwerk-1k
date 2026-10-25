import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';

const app = new App(document.getElementById('app')!);

// Audio-Start: jede erste Berührung startet den AudioContext (Safari/iOS-Pflicht)
const overlay = document.getElementById('unlock')!;
window.addEventListener('pointerdown', () => void app.unlock(), { capture: true });
overlay.addEventListener('click', () => void app.unlock());

new ResizeObserver(() => { app.lcd.resize(); app.lcd.render(true); }).observe(app.panel.els.lcd);

// Offline-Fähigkeit (im Vorschau-Rahmen nicht verfügbar – Fehler dort bewusst ignoriert)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  try { registerSW({ immediate: true, onRegisterError: () => {} }); } catch { /* Vorschau ohne Service Worker */ }
}

// Für Browser-Tests
(window as unknown as { __padwerk: unknown }).__padwerk = { app, bus: app.bus, engine: app.engine, store: app.store, ui: app.ui, state: app.diag, fb: app.fb };
