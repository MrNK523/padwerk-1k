import type { ButtonId, HwBus, PadIndex } from '../../input/events';
import { velocityFromPosition } from '../../input/velocity';
import { LCD_H, LCD_W } from '../display/framebuffer';

/** Tasten, die per Doppeltipp einrasten (Latch) – für Ein-Finger-Bedienung von Kombis. */
export const LATCHABLE: ReadonlySet<ButtonId> = new Set<ButtonId>(['SHIFT', 'ERASE', 'TAP_TEMPO', 'MODE', 'REC', 'OVER_DUB', 'UNDO_SEQ']);
const DOUBLE_TAP_MS = 320;
const WHEEL_STEP_DEG = 15;
const DISPLAY_SWIPE_PX = 14;

interface KeyDef { id: ButtonId; label: string; sub?: string; cls?: string }

const SOFTKEYS: KeyDef[] = (['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const).map((id) => ({ id, label: id, cls: 'soft' }));

const NAV_KEYS: KeyDef[] = [
  { id: 'MODE', label: 'MODE' }, { id: 'MAIN', label: 'MAIN' }, { id: 'WINDOW', label: 'WINDOW' },
  { id: 'SHIFT', label: 'SHIFT' }, { id: 'UNDO_SEQ', label: 'UNDO', sub: 'SEQ' }, { id: 'ERASE', label: 'ERASE' },
  { id: 'NUMERIC', label: 'NUM' }, { id: 'TAP_TEMPO', label: 'TAP', sub: 'REPEAT' },
];

const TRANSPORT: KeyDef[] = [
  { id: 'REC', label: 'REC', cls: 'rec' }, { id: 'OVER_DUB', label: 'DUB', cls: 'rec' },
  { id: 'STOP', label: '■' }, { id: 'PLAY', label: '▶' }, { id: 'PLAY_START', label: '|▶', sub: 'START' },
];

const LOCATE: KeyDef[] = [
  { id: 'STEP_PREV', label: '‹', sub: 'STEP' }, { id: 'STEP_NEXT', label: '›', sub: 'STEP' },
  { id: 'BAR_PREV', label: '«', sub: 'BAR' }, { id: 'BAR_NEXT', label: '»', sub: 'BAR' },
];

const PAD_FUNCS: KeyDef[] = [
  { id: 'FULL_LEVEL', label: 'FULL', sub: 'LEVEL' }, { id: 'LEVELS_16', label: '16', sub: 'LEVELS' },
  { id: 'NEXT_SEQ', label: 'NEXT', sub: 'SEQ' }, { id: 'TRACK_MUTE', label: 'TRACK', sub: 'MUTE' },
];

const BANKS: KeyDef[] = [
  { id: 'BANK_A', label: 'A' }, { id: 'BANK_B', label: 'B' }, { id: 'BANK_C', label: 'C' }, { id: 'BANK_D', label: 'D' },
];

/** Reihenfolge im DOM: oberste Reihe zuerst (Pads 13–16), unterste zuletzt (Pads 1–4). */
const PAD_ORDER: PadIndex[] = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface PanelElements {
  root: HTMLElement;
  lcd: HTMLCanvasElement;
  pads: Map<PadIndex, HTMLElement>;
  buttons: Map<ButtonId, HTMLElement[]>;
}

/** Baut das Bedienfeld und verbindet alle Bedienelemente mit dem Hardware-Bus. */
export class Panel {
  readonly els: PanelElements;
  private latched = new Set<ButtonId>();
  private lastTap = new Map<ButtonId, number>();
  /** Wie viele Pointer halten eine Taste gerade (Multitouch: mehrere Finger, mehrere Exemplare). */
  private held = new Map<ButtonId, number>();

  constructor(container: HTMLElement, private bus: HwBus) {
    this.els = this.build(container);
  }

  private build(container: HTMLElement): PanelElements {
    const root = el('div', 'device');
    const buttons = new Map<ButtonId, HTMLElement[]>();
    const pads = new Map<PadIndex, HTMLElement>();
    const mkKey = (k: KeyDef): HTMLElement => {
      const b = el('button', `key ${k.cls ?? ''}`.trim());
      b.type = 'button';
      b.dataset.btn = k.id;
      b.setAttribute('aria-label', k.sub ? `${k.label} ${k.sub}` : k.label);
      b.append(el('span', 'key-label', k.label));
      if (k.sub) b.append(el('span', 'key-sub', k.sub));
      const led = el('i', 'led');
      b.append(led);
      this.bindButton(b, k.id);
      const list = buttons.get(k.id) ?? [];
      list.push(b);
      buttons.set(k.id, list);
      return b;
    };

    // --- linke Seite: Display, Softkeys, Bedienung ---
    const left = el('section', 'side side-left');
    const brand = el('div', 'brand');
    brand.append(el('span', 'brand-name', 'PADWERK'), el('span', 'brand-model', '1K'));
    const bezel = el('div', 'bezel');
    const lcd = el('canvas', 'lcd');
    lcd.width = LCD_W * 3;
    lcd.height = LCD_H * 3;
    lcd.setAttribute('role', 'img');
    lcd.setAttribute('aria-label', 'Display');
    bezel.append(lcd);
    this.bindDisplay(lcd);
    const soft = el('div', 'row softkeys');
    SOFTKEYS.forEach((k) => soft.append(mkKey(k)));

    const controls = el('div', 'controls');
    const nav = el('div', 'grid nav');
    NAV_KEYS.forEach((k) => nav.append(mkKey(k)));
    const cursor = el('div', 'cursor');
    (['CURSOR_UP', 'CURSOR_LEFT', 'CURSOR_RIGHT', 'CURSOR_DOWN'] as const).forEach((id) => {
      const arrow = { CURSOR_UP: '▲', CURSOR_DOWN: '▼', CURSOR_LEFT: '◀', CURSOR_RIGHT: '▶' }[id];
      cursor.append(mkKey({ id, label: arrow, cls: `cur ${id.toLowerCase()}` }));
    });
    const wheel = el('div', 'wheel');
    wheel.setAttribute('role', 'slider');
    wheel.setAttribute('aria-label', 'Data Wheel');
    wheel.append(el('div', 'wheel-knurl'), el('div', 'wheel-dimple'));
    this.bindWheel(wheel);
    controls.append(nav, cursor, wheel);

    const sliders = el('div', 'sliders');
    ([0, 1] as const).forEach((i) => sliders.append(this.mkSlider(i)));
    sliders.append(mkKey({ id: 'AFTER', label: 'AFTER' }));

    const transport = el('div', 'row transport');
    LOCATE.forEach((k) => transport.append(mkKey(k)));
    TRANSPORT.forEach((k) => transport.append(mkKey(k)));

    left.append(brand, bezel, soft, controls, sliders, transport);

    // --- rechte Seite: Pad-Funktionen, Banks, Pads ---
    const right = el('section', 'side side-right');
    const funcs = el('div', 'row padfuncs');
    PAD_FUNCS.forEach((k) => funcs.append(mkKey(k)));
    const banks = el('div', 'row banks');
    banks.append(el('span', 'banks-label', 'PAD BANK'));
    BANKS.forEach((k) => banks.append(mkKey({ ...k, cls: 'bank' })));
    const padGrid = el('div', 'pads');
    for (const p of PAD_ORDER) {
      const pad = el('div', 'pad');
      pad.dataset.pad = String(p);
      pad.setAttribute('role', 'button');
      pad.setAttribute('aria-label', `Pad ${p + 1}`);
      pad.append(el('span', 'pad-num', String(p + 1)));
      this.bindPad(pad, p);
      pads.set(p, pad);
      padGrid.append(pad);
    }
    right.append(funcs, banks, padGrid);

    root.append(left, right);
    container.append(root);
    return { root, lcd, pads, buttons };
  }

  // ---------- Tasten (Multitouch + Latch) ----------

  private bindButton(b: HTMLElement, id: ButtonId): void {
    const pointers = new Set<number>();
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      pointers.add(ev.pointerId);
      const now = performance.now();
      if (LATCHABLE.has(id)) {
        if (this.latched.has(id)) {
          // Eingerastete Taste: Tippen löst sie
          this.latched.delete(id);
          this.setPressed(id, false);
          this.release(id, ev.pointerType);
          this.lastTap.delete(id);
          pointers.delete(ev.pointerId);
          return;
        }
        const prev = this.lastTap.get(id);
        this.lastTap.set(id, now);
        if (prev !== undefined && now - prev < DOUBLE_TAP_MS) {
          // Doppeltipp: Taste rastet ein und bleibt gedrückt, bis sie erneut angetippt wird
          this.latched.add(id);
          this.lastTap.delete(id);
          this.press(id, ev.pointerType);
          this.setPressed(id, true, true);
          return;
        }
      }
      this.press(id, ev.pointerType);
    });
    const up = (ev: PointerEvent) => {
      if (!pointers.delete(ev.pointerId)) return;
      if (this.latched.has(id)) return;
      this.release(id, ev.pointerType);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  private press(id: ButtonId, pointerType: string): void {
    const n = (this.held.get(id) ?? 0) + 1;
    this.held.set(id, n);
    if (n === 1) {
      this.setPressed(id, true);
      this.bus.emit({ kind: 'button', id, down: true, source: pointerType === 'touch' ? 'touch' : 'mouse' });
    }
  }

  private release(id: ButtonId, pointerType: string): void {
    const n = Math.max(0, (this.held.get(id) ?? 0) - 1);
    this.held.set(id, n);
    if (n === 0) {
      this.setPressed(id, false);
      this.bus.emit({ kind: 'button', id, down: false, source: pointerType === 'touch' ? 'touch' : 'mouse' });
    }
  }

  setPressed(id: ButtonId, on: boolean, latched = false): void {
    for (const b of this.els?.buttons.get(id) ?? []) {
      b.classList.toggle('down', on);
      b.classList.toggle('latched', on && latched);
    }
  }

  /** LED einer Taste (z. B. FULL LEVEL an, aktive Bank). */
  setLed(id: ButtonId, on: boolean): void {
    for (const b of this.els.buttons.get(id) ?? []) b.classList.toggle('lit', on);
  }

  /** Blinkende LED (MODE wartet auf ein Pad). */
  setBlink(id: ButtonId, on: boolean): void {
    for (const b of this.els.buttons.get(id) ?? []) b.classList.toggle('blink', on);
  }

  /** Modus-Beschriftung über den Pads (wie auf dem Gehäuse aufgedruckt). */
  setPadLabels(labels: readonly string[]): void {
    for (const [index, pad] of this.els.pads) {
      let el = pad.querySelector<HTMLElement>('.pad-mode');
      if (!el) { el = document.createElement('span'); el.className = 'pad-mode'; pad.append(el); }
      el.textContent = labels[index] ?? '';
    }
  }

  /** Während MODE blinkt, werden die Modus-Beschriftungen hervorgehoben. */
  showModeLabels(on: boolean): void {
    this.els.root.classList.toggle('mode-select', on);
  }

  isLatched(id: ButtonId): boolean {
    return this.latched.has(id);
  }

  // ---------- Pads ----------

  private bindPad(pad: HTMLElement, index: PadIndex): void {
    const pointers = new Set<number>();
    pad.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      pad.setPointerCapture(ev.pointerId);
      pointers.add(ev.pointerId);
      const r = pad.getBoundingClientRect();
      const velocity = velocityFromPosition((ev.clientY - r.top) / r.height);
      this.flashPad(index, velocity);
      this.bus.emit({ kind: 'pad', pad: index, down: true, velocity, source: ev.pointerType === 'touch' ? 'touch' : 'mouse' });
    });
    const up = (ev: PointerEvent) => {
      if (!pointers.delete(ev.pointerId)) return;
      if (pointers.size === 0) pad.classList.remove('hit');
      this.bus.emit({ kind: 'pad', pad: index, down: false, velocity: 0, source: ev.pointerType === 'touch' ? 'touch' : 'mouse' });
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  /** Optisches Feedback: Leuchtstärke folgt der Velocity. */
  flashPad(index: PadIndex, velocity: number): void {
    const pad = this.els?.pads.get(index);
    if (!pad) return;
    pad.style.setProperty('--glow', String(Math.max(0.25, velocity / 127)));
    pad.classList.remove('hit');
    void pad.offsetWidth; // Animation neu starten
    pad.classList.add('hit');
  }

  releasePadVisual(index: PadIndex): void {
    this.els.pads.get(index)?.classList.remove('hit');
  }

  // ---------- Data Wheel ----------

  private bindWheel(wheel: HTMLElement): void {
    let lastAngle: number | null = null;
    let acc = 0;
    const angleOf = (ev: PointerEvent) => {
      const r = wheel.getBoundingClientRect();
      return (Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    wheel.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      wheel.setPointerCapture(ev.pointerId);
      lastAngle = angleOf(ev);
      acc = 0;
    });
    wheel.addEventListener('pointermove', (ev) => {
      if (lastAngle === null) return;
      const a = angleOf(ev);
      let d = a - lastAngle;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      lastAngle = a;
      acc += d;
      wheel.style.setProperty('--rot', `${(parseFloat(wheel.style.getPropertyValue('--rot')) || 0) + d}deg`);
      while (Math.abs(acc) >= WHEEL_STEP_DEG) {
        const step = acc > 0 ? 1 : -1;
        acc -= step * WHEEL_STEP_DEG;
        this.bus.emit({ kind: 'wheel', delta: step, source: ev.pointerType === 'touch' ? 'touch' : 'mouse' });
      }
    });
    const end = () => { lastAngle = null; };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);
    wheel.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.bus.emit({ kind: 'wheel', delta: ev.deltaY < 0 ? 1 : -1, source: 'mouse' });
    }, { passive: false });
  }

  // ---------- Display: Wischen = Wheel ----------

  private bindDisplay(lcd: HTMLCanvasElement): void {
    let startY: number | null = null;
    let acc = 0;
    lcd.addEventListener('pointerdown', (ev) => {
      lcd.setPointerCapture(ev.pointerId);
      startY = ev.clientY;
      acc = 0;
    });
    lcd.addEventListener('pointermove', (ev) => {
      if (startY === null) return;
      acc += startY - ev.clientY;
      startY = ev.clientY;
      while (Math.abs(acc) >= DISPLAY_SWIPE_PX) {
        const step = acc > 0 ? 1 : -1;
        acc -= step * DISPLAY_SWIPE_PX;
        this.bus.emit({ kind: 'wheel', delta: step, source: 'touch' });
      }
    });
    const end = () => { startY = null; };
    lcd.addEventListener('pointerup', end);
    lcd.addEventListener('pointercancel', end);
    lcd.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.bus.emit({ kind: 'wheel', delta: ev.deltaY < 0 ? 1 : -1, source: 'mouse' });
    }, { passive: false });
  }

  // ---------- Q-Slider ----------

  private mkSlider(i: 0 | 1): HTMLElement {
    const wrap = el('div', 'slider');
    const track = el('div', 'slider-track');
    const cap = el('div', 'slider-cap');
    track.append(cap);
    wrap.append(track, el('span', 'slider-label', `Q${i + 1}`));
    wrap.setAttribute('role', 'slider');
    wrap.setAttribute('aria-label', `Slider Q${i + 1}`);
    let active = false;
    const setFrom = (ev: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const norm = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const value = Math.round(norm * 127);
      track.style.setProperty('--pos', String(norm));
      this.bus.emit({ kind: 'slider', slider: i, value, source: ev.pointerType === 'touch' ? 'touch' : 'mouse' });
    };
    track.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      track.setPointerCapture(ev.pointerId);
      active = true;
      setFrom(ev);
    });
    track.addEventListener('pointermove', (ev) => { if (active) setFrom(ev); });
    track.addEventListener('pointerup', () => { active = false; });
    track.addEventListener('pointercancel', () => { active = false; });
    return wrap;
  }
}
