/**
 * Verdrahtung: Eingabe → Hardware-Ereignisse → Screens → Store → Engine.
 * Hier liegen nur globale Tasten (MODE, MAIN, Banks, FULL LEVEL, 16 LEVELS) und das Pad-Spielen;
 * alles Modus-spezifische steckt in den Screens.
 */
import { levels16Variation } from '../core/levels16';
import { padName } from '../core/model';
import { makeStarterKit, KIT_RATE } from '../dsp/kit';
import { AudioEngine } from '../engine/audioEngine';
import { syncEngine } from '../engine/engineSync';
import { HwBus, type ButtonId, type HwEvent } from '../input/events';
import { attachKeyboard } from '../input/keyboardInput';
import { ACCEPTED_AUDIO, importAudio, rootNoteFromName } from '../io/importAudio';
import { Store } from '../state/store';
import { FrameBuffer } from './display/framebuffer';
import { LcdRenderer } from './display/lcdRenderer';
import { Panel } from './panel/panel';
import { DiagScreen, initialDiagState, type DiagState } from './screens/diagScreen';
import { ProgramScreen } from './screens/programScreen';
import { type AppCtx, type Screen, type UiState } from './screens/screen';
import { LoadScreen, MainScreen, MODE_PADS, ModeSelectOverlay, PlaceholderScreen } from './screens/simpleScreens';
import { AssignToPadWindow, Levels16Window } from './screens/windows';

const BANK_OF: Partial<Record<ButtonId, 0 | 1 | 2 | 3>> = { BANK_A: 0, BANK_B: 1, BANK_C: 2, BANK_D: 3 };

export class App implements AppCtx {
  readonly store = new Store();
  readonly engine = new AudioEngine();
  readonly bus = new HwBus();
  readonly fb = new FrameBuffer();
  readonly panel: Panel;
  readonly lcd: LcdRenderer;
  readonly ui: UiState = {
    bank: 0, fullLevel: false, fullLevelValue: 127, levels16On: false,
    levels16: { type: 'VELOCITY', sourcePad: 0, originalKeyPad: 0 },
    selectedPad: 0, lastVelocity: null, held: new Set(), message: '',
  };
  readonly diag: DiagState = initialDiagState();
  private screens: Record<string, Screen>;
  private screen: Screen;
  private windows: Screen[] = [];
  private modeSelect = false;
  private voices = 0;
  private dirty = true;
  private stopTaps: number[] = [];
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private fileInput: HTMLInputElement;
  private loadOpts = { assignToPad: true, lastLoaded: [] as string[] };
  /** welches Program-Pad ein physisches Pad gerade hält (für Note-Off nach Bankwechsel) */
  private heldPads = new Map<number, { pad: number; programId: string }>();

  constructor(container: HTMLElement) {
    this.panel = new Panel(container, this.bus);
    this.lcd = new LcdRenderer(this.panel.els.lcd, this.fb);
    this.panel.setPadLabels(MODE_PADS.map((m) => m.short));
    syncEngine(this.store, this.engine);

    const main = new MainScreen(this, () => this.voices);
    this.screens = {
      main,
      program: new ProgramScreen(this),
      load: new LoadScreen(this, this.loadOpts),
      other: new DiagScreen(this.diag, { measure: () => void this.measure(), allSoundOff: () => this.engine.send({ type: 'allSoundOff' }) }),
      modeSelect: new ModeSelectOverlay(),
    };
    this.screen = main;

    this.fileInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: ACCEPTED_AUDIO });
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      void this.importFiles(files);
    });
    document.body.append(this.fileInput);
    this.bindDragDrop();

    this.store.on(() => this.touch());
    this.bus.on((e) => this.onEvent(e));
    attachKeyboard(window, this.bus);
    this.engine.onMessage((m) => {
      if (m.type === 'status' && m.activeVoices !== this.voices) { this.voices = m.activeVoices; this.diag.voices = m.activeVoices; this.touch(); }
    });
    this.updateLeds();
    this.loop();
    setTimeout(() => this.loadStarterKit(), 0);
    setInterval(() => this.pollEngine(), 250);
  }

  /** Oberster sichtbarer Screen bzw. Fenster (für Tests und Anzeige). */
  get screenId(): string {
    if (this.modeSelect) return 'mode-select';
    return (this.windows.at(-1) ?? this.screen).id;
  }

  get activeVoices(): number { return this.voices; }

  // ---------- AppCtx ----------

  openWindow(w: Screen): void { this.windows.push(w); this.touch(); }
  closeWindow(): void { this.windows.pop(); this.touch(); }
  openFilePicker(): void { this.fileInput.click(); }
  coarse(): boolean { return this.ui.held.has('SHIFT') || this.ui.held.has('TAP_TEMPO'); }

  flash(text: string): void {
    this.ui.message = text;
    this.diag.message = text;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { this.ui.message = ''; this.touch(); }, 2500);
    this.touch();
  }

  playPadIndex(pad: number, velocity: number): void {
    this.engine.send({ type: 'padOn', programId: this.store.currentProgram.id, pad, velocity });
  }

  stopPadIndex(pad: number): void {
    this.engine.send({ type: 'padOff', programId: this.store.currentProgram.id, pad });
  }

  // ---------- Modi ----------

  setMode(id: string): void {
    const s = this.screens[id];
    this.windows = [];
    if (s) { this.screen = s; s.onEnter?.(); }
    this.touch();
  }

  private modeFromPad(pad: number): void {
    const m = MODE_PADS[pad]!;
    const id = { 1: 'load', 6: 'program', 9: 'other' }[pad];
    if (id) this.setMode(id);
    else {
      this.screens[`ph${pad}`] ??= new PlaceholderScreen(`ph${pad}`, m.name, m.milestone);
      this.setMode(`ph${pad}`);
    }
  }

  // ---------- Ereignisse ----------

  private onEvent(e: HwEvent): void {
    if (e.kind === 'button') {
      if (e.down) this.ui.held.add(e.id); else this.ui.held.delete(e.id);
      if (e.source !== 'touch' && e.source !== 'mouse') this.panel.setPressed(e.id, e.down);
    }
    if (e.source === 'keyboard') void this.unlock();
    this.touch();

    // MODE blinkt: nächstes Pad wählt den Modus
    if (this.modeSelect) {
      if (e.kind === 'pad' && e.down) { this.modeSelect = false; this.modeFromPad(e.pad); this.updateLeds(); return; }
      if (e.kind === 'button' && e.down && (e.id === 'MODE' || e.id === 'MAIN')) { this.modeSelect = false; this.updateLeds(); if (e.id === 'MAIN') this.setMode('main'); return; }
      if (e.kind === 'pad') return;
    }

    // FULL LEVEL halten + Wheel: Wert einstellen (JJOS2XL)
    if (e.kind === 'wheel' && this.ui.held.has('FULL_LEVEL')) {
      this.ui.fullLevelValue = Math.min(127, Math.max(1, this.ui.fullLevelValue + e.delta * (this.coarse() ? 10 : 1)));
      this.fullLevelAdjusted = true;
      this.flash(`Full Level ${this.ui.fullLevelValue}`);
      return;
    }

    const top = this.windows.at(-1) ?? this.screen;
    if (top.onEvent(e)) return;

    switch (e.kind) {
      case 'pad':
        this.handlePad(e.pad, e.down, e.velocity, e.source);
        return;
      case 'button':
        if (e.down) this.globalButtonDown(e.id);
        else this.globalButtonUp(e.id);
        return;
      case 'wheel':
      case 'slider':
        if (this.screen === this.screens.other) {
          if (e.kind === 'wheel') this.diag.wheel += e.delta; else this.diag.sliders[e.slider] = e.value;
        }
        return;
    }
  }

  private fullLevelAdjusted = false;

  private globalButtonDown(id: ButtonId): void {
    const bank = BANK_OF[id];
    if (bank !== undefined) { this.ui.bank = bank; this.diag.bank = bank; this.updateLeds(); return; }
    this.diag.lastButton = id;
    switch (id) {
      case 'MODE': this.modeSelect = true; this.updateLeds(); return;
      case 'MAIN': this.setMode('main'); return;
      case 'FULL_LEVEL': this.fullLevelAdjusted = false; return;
      case 'LEVELS_16':
        if (this.ui.levels16On) { this.ui.levels16On = false; this.flash('16 Levels aus'); this.updateLeds(); }
        else this.openWindow(new Levels16Window(this));
        return;
      case 'STOP': {
        // STOP dreimal schnell = alle Klänge aus (MPC1000-Handbuch)
        const now = performance.now();
        this.stopTaps = [...this.stopTaps.filter((t) => now - t < 600), now];
        if (this.stopTaps.length >= 3) { this.engine.send({ type: 'allSoundOff' }); this.stopTaps = []; this.flash('Alle Klänge aus'); }
        return;
      }
    }
  }

  private globalButtonUp(id: ButtonId): void {
    if (id === 'FULL_LEVEL' && !this.fullLevelAdjusted) {
      this.ui.fullLevel = !this.ui.fullLevel;
      this.diag.fullLevel = this.ui.fullLevel;
      this.updateLeds();
    }
  }

  private handlePad(physical: number, down: boolean, rawVelocity: number, source: HwEvent['source']): void {
    if (!down) {
      const h = this.heldPads.get(physical);
      this.heldPads.delete(physical);
      if (h) this.engine.send({ type: 'padOff', programId: h.programId, pad: h.pad });
      if (source === 'keyboard') this.panel.releasePadVisual(physical);
      return;
    }
    const programId = this.store.currentProgram.id;
    const velocity = this.ui.fullLevel ? this.ui.fullLevelValue : rawVelocity;
    let pad = this.ui.bank * 16 + physical;
    let variation;
    if (this.ui.levels16On) {
      pad = this.ui.levels16.sourcePad;
      variation = levels16Variation(this.ui.levels16, physical);
    } else {
      this.ui.selectedPad = pad;
    }
    this.heldPads.set(physical, { pad, programId });
    this.engine.send({ type: 'padOn', programId, pad, velocity, variation });
    this.ui.lastVelocity = variation?.velocity ?? velocity;
    this.diag.lastPad = padName(this.ui.bank * 16 + physical);
    this.diag.lastVelocity = this.ui.lastVelocity;
    if (source === 'keyboard') this.panel.flashPad(physical, velocity);
  }

  private updateLeds(): void {
    (['BANK_A', 'BANK_B', 'BANK_C', 'BANK_D'] as const).forEach((id, i) => this.panel.setLed(id, this.ui.bank === i));
    this.panel.setLed('FULL_LEVEL', this.ui.fullLevel);
    this.panel.setLed('LEVELS_16', this.ui.levels16On);
    this.panel.setBlink('MODE', this.modeSelect);
    this.panel.showModeLabels(this.modeSelect);
  }

  // ---------- Audio ----------

  async unlock(): Promise<void> {
    if (this.engine.running) return;
    this.diag.audio = 'startet';
    this.touch();
    try {
      await this.engine.start();
      const l = this.engine.latency();
      this.diag.audio = 'läuft';
      if (l) Object.assign(this.diag, { sampleRate: l.sampleRate, baseMs: l.baseMs, outputMs: l.outputMs, blockMs: l.blockMs });
      document.getElementById('unlock')?.setAttribute('hidden', '');
    } catch (err) {
      this.diag.audio = 'Fehler';
      this.flash(String((err as Error).message ?? err).slice(0, 38));
      console.error(err);
    }
    this.touch();
  }

  private pollEngine(): void {
    if (!this.engine.running) return;
    const l = this.engine.latency();
    if (l && (l.outputMs !== this.diag.outputMs || l.baseMs !== this.diag.baseMs)) {
      this.diag.outputMs = l.outputMs;
      this.diag.baseMs = l.baseMs;
      this.touch();
    }
    this.engine.send({ type: 'statusRequest' });
  }

  private async measure(): Promise<void> {
    this.flash('Messe ... Lautsprecher an');
    try {
      const r = await this.engine.measureRoundTrip();
      if (r.ok && r.ms !== undefined) { this.diag.roundTripMs = r.ms; this.flash('Messung ok'); }
      else this.flash(`kein Klick erkannt (${(r.peak * 100).toFixed(0)}%)`);
    } catch (err) {
      this.flash('Mikrofon nicht verfügbar');
      console.warn(err);
    }
  }

  // ---------- Samples ----------

  private loadStarterKit(): void {
    const kit = makeStarterKit();
    const pid = this.store.currentProgram.id;
    kit.forEach((k, i) => {
      const s = this.store.addSample(k.name, { channels: [k.data], sampleRate: KIT_RATE });
      this.store.updateLayer(pid, i, 0, { sampleId: s.id });
    });
    // sinnvolle Grundeinstellungen: HiHats in einer Mute-Gruppe, Becken/Bass klingen aus
    this.store.updatePad(pid, 5, { muteGroup: 1 });
    this.store.updatePad(pid, 6, { muteGroup: 1 });
    this.flash('Start-Kit geladen (Bank A)');
  }

  async importFiles(files: File[], assignTo?: number): Promise<void> {
    const loaded = [];
    for (const f of files) {
      try {
        const data = await f.arrayBuffer();
        const audio = await importAudio(data, (b) => this.engine.decode(b));
        const meta = this.store.addSample(f.name, audio, rootNoteFromName(f.name) ?? 60);
        loaded.push(meta);
        this.loadOpts.lastLoaded.push(meta.name);
      } catch (err) {
        console.warn(err);
        this.flash(`${f.name.slice(0, 20)}: nicht lesbar`);
      }
    }
    if (!loaded.length) return;
    if (assignTo !== undefined) {
      const pid = this.store.currentProgram.id;
      loaded.forEach((s, i) => this.store.updateLayer(pid, Math.min(63, assignTo + i), 0, { sampleId: s.id }));
      this.ui.selectedPad = assignTo;
      this.flash(`${loaded[0]!.name} → ${padName(assignTo)}`);
    } else if (this.loadOpts.assignToPad) {
      this.openWindow(new AssignToPadWindow(this, loaded));
    } else {
      this.flash(`${loaded.length} Sample(s) geladen`);
    }
  }

  private bindDragDrop(): void {
    const root = this.panel.els.root;
    window.addEventListener('dragover', (ev) => { ev.preventDefault(); root.classList.add('drop'); });
    window.addEventListener('dragleave', (ev) => { if (ev.target === document.documentElement || !ev.relatedTarget) root.classList.remove('drop'); });
    window.addEventListener('drop', (ev) => {
      ev.preventDefault();
      root.classList.remove('drop');
      const files = [...(ev.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const padEl = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.pad');
      const physical = padEl ? Number(padEl.dataset.pad) : undefined;
      void this.importFiles(files, physical !== undefined ? this.ui.bank * 16 + physical : undefined);
    });
  }

  // ---------- Zeichnen ----------

  touch(): void { this.dirty = true; }

  private loop = (): void => {
    if (this.dirty) {
      this.dirty = false;
      this.updateLeds();
      const base = this.modeSelect ? this.screens.modeSelect! : this.screen;
      base.render(this.fb);
      if (!this.modeSelect) for (const w of this.windows) w.render(this.fb);
      // Kurze Hinweise erscheinen in der Kopfzeile (der Main-Screen zeigt sie selbst unten)
      if (this.ui.message && !this.modeSelect && base.id !== 'main' && base.id !== 'other' && this.windows.length === 0) {
        this.fb.fillRect(0, 0, 240, 8, false);
        this.fb.text(1, 0, this.ui.message.slice(0, 39));
        this.fb.invertRect(0, 0, 240, 8);
      }
    }
    this.lcd.render();
    requestAnimationFrame(this.loop);
  };
}
