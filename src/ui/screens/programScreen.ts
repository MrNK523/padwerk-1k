/**
 * PROGRAM (MODE + PAD 7) – nach dem Vorbild von JJOS2XL „Global Program Edit“:
 * eine Tabelle mit einer Zeile pro Pad und einer Spalte pro Parameter, Seiten über F1–F6.
 * M1: SAMPLE, AMP, FILTER, MUTE, OUT. PITCH und LFO folgen in M9.
 */
import {
  type FilterType, type MuteMode, type PadParams, type PlayMode, type SoundMode, type VoiceOverlap, padName,
} from '../../core/model';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import { FrameBuffer, LCD_W } from '../display/framebuffer';
import {
  type AppCtx, type Screen, drawSoftkeys, formatPan, formatTune, pad2, pad3, step, stepEnum,
} from './screen';
import { LayerWindow, ProgramListWindow, SampleListWindow } from './windows';

type Page = 'SAMPLE' | 'AMP' | 'FILTER' | 'PITCH' | 'MUTE' | 'LFO' | 'OUT';

interface Column {
  label: string;
  width: number;
  /** Zahlenspalten: Kopf rechtsbündig über den Werten */
  right?: boolean;
  text(p: PadParams, pad: number): string;
  /** Wheel-Änderung; `d` = Schritte (×10 bei SHIFT/TAP) */
  wheel?(pad: number, d: number, raw: number): void;
  window?(pad: number): Screen | null;
  /** Wert dieser Spalte von einem Pad auf ein anderes kopieren (UNDO SEQ + Pad) */
  copy?(from: PadParams, to: number): void;
}

const VISIBLE_ROWS = 5;
const PLAY_MODES: readonly PlayMode[] = ['ONE_SHOT', 'NOTE_ON'];
const VOICES: readonly VoiceOverlap[] = ['POLY', 'MONO'];
const SOUNDS: readonly SoundMode[] = ['ST', 'L+R', 'L', 'R'];
const FILTERS: readonly FilterType[] = ['OFF', 'LPF', 'BPF', 'HPF', 'EQL', 'EQH'];
const MUTE_MODES: readonly MuteMode[] = ['MUTE', 'SIMULT1', 'SIMULT2'];

export class ProgramScreen implements Screen {
  readonly id = 'program';
  private page: Page = 'SAMPLE';
  private col = 1;
  /** true = Cursor steht im Program-Feld der Kopfzeile */
  private onHeader = false;
  private top = 0;

  constructor(private ctx: AppCtx) {}

  private get store() { return this.ctx.store; }
  private get pid() { return this.store.currentProgram.id; }
  private get pad() { return this.ctx.ui.selectedPad; }

  softkeys(): readonly string[] {
    return ['SAMPLE', 'AMP', 'FILTER', 'PITCH', this.page === 'LFO' ? 'LFO' : 'MUTE', 'OUT'];
  }

  activeSoftkey(): number {
    return { SAMPLE: 0, AMP: 1, FILTER: 2, PITCH: 3, MUTE: 4, LFO: 4, OUT: 5 }[this.page];
  }

  // ---------- Spalten je Seite ----------

  private columns(): Column[] {
    const s = this.store;
    const pid = this.pid;
    const upd = (pad: number, patch: Partial<Omit<PadParams, 'layers'>>) => s.updatePad(pid, pad, patch);
    const l0 = (pad: number, patch: Partial<PadParams['layers'][0]>) => s.updateLayer(pid, pad, 0, patch);
    const num = (label: string, width: number, get: (p: PadParams) => number, set: (pad: number, v: number) => void, min = 0, max = 100): Column => ({
      label, width, right: true,
      text: (p) => String(get(p)).padStart(width),
      wheel: (pad, d) => set(pad, step(get(s.currentProgram.pads[pad]!), d, min, max)),
      copy: (from, to) => set(to, get(from)),
    });
    const padCol: Column = {
      label: 'PAD', width: 3,
      text: (_p, pad) => padName(pad),
      wheel: (_pad, _d, raw) => { this.ctx.ui.selectedPad = step(this.pad, raw, 0, 63); },
      window: (pad) => new LayerWindow(this.ctx, pad),
      copy: (_from, to) => s.copyPad(pid, this.pad, [to]),
    };

    switch (this.page) {
      case 'SAMPLE': return [
        padCol,
        {
          // JJOS2XL zeigt bei Chop-Samples zusätzlich die Chop-Nummer; 13 Zeichen + CHP passen in 40 Spalten
          label: 'SAMPLE', width: 13,
          text: (p) => (s.sample(p.layers[0].sampleId)?.name ?? '').padEnd(13),
          wheel: (pad, _d, raw) => {
            const list = [null, ...s.samplesSorted().map((x) => x.id)];
            const cur = s.currentProgram.pads[pad]!.layers[0].sampleId;
            const i = Math.max(0, list.indexOf(cur));
            l0(pad, { sampleId: list[Math.min(list.length - 1, Math.max(0, i + raw))] ?? null });
          },
          window: (pad) => new SampleListWindow(this.ctx, s.currentProgram.pads[pad]!.layers[0].sampleId, (id) => l0(pad, { sampleId: id })),
          copy: (from, to) => l0(to, { sampleId: from.layers[0].sampleId, chop: from.layers[0].chop }),
        },
        {
          label: 'CH', width: 2, right: true,
          text: (p) => {
            const m = s.sample(p.layers[0].sampleId);
            return m?.chopOn && p.layers[0].chop > 0 ? String(p.layers[0].chop).padStart(2, '0') : '--';
          },
          wheel: (pad, _d, raw) => {
            const l = s.currentProgram.pads[pad]!.layers[0];
            const m = s.sample(l.sampleId);
            if (!m?.chopOn) return;
            l0(pad, { chop: step(l.chop, raw, 0, m.chops.length) });
          },
          copy: (from, to) => l0(to, { chop: from.layers[0].chop }),
        },
        {
          label: 'SND', width: 3,
          text: (p) => p.layers[0].sound.padEnd(3),
          wheel: (pad, _d, raw) => l0(pad, { sound: stepEnum(SOUNDS, s.currentProgram.pads[pad]!.layers[0].sound, raw) }),
          copy: (from, to) => l0(to, { sound: from.layers[0].sound }),
        },
        {
          label: 'DIR', width: 3,
          text: (p) => p.layers[0].dir,
          wheel: (pad, _d, raw) => l0(pad, { dir: raw > 0 ? 'REV' : 'FOR' }),
          copy: (from, to) => l0(to, { dir: from.layers[0].dir }),
        },
        num('LEV', 3, (p) => p.layers[0].level, (pad, v) => l0(pad, { level: v })),
        {
          label: 'TUNE', width: 6,
          text: (p) => formatTune(p.layers[0].tune),
          // Wheel = 1 Halbton; mit SHIFT 1 Cent (Bedienhilfe D-11)
          wheel: (pad, _d, raw) => {
            const t = s.currentProgram.pads[pad]!.layers[0].tune;
            const delta = this.ctx.ui.held.has('SHIFT') ? raw / 100 : raw;
            l0(pad, { tune: Math.round(step(t, delta, -36, 36) * 100) / 100 });
          },
          copy: (from, to) => l0(to, { tune: from.layers[0].tune }),
        },
      ];
      case 'AMP': return [
        padCol,
        {
          label: 'PLAY', width: 8,
          text: (p) => (p.playMode === 'ONE_SHOT' ? 'ONE SHOT' : 'NOTE ON '),
          wheel: (pad, _d, raw) => upd(pad, { playMode: stepEnum(PLAY_MODES, s.currentProgram.pads[pad]!.playMode, raw) }),
          copy: (from, to) => upd(to, { playMode: from.playMode }),
        },
        {
          label: 'VOIC', width: 4,
          text: (p) => p.voice,
          wheel: (pad, _d, raw) => upd(pad, { voice: stepEnum(VOICES, s.currentProgram.pads[pad]!.voice, raw) }),
          copy: (from, to) => upd(to, { voice: from.voice }),
        },
        num('VEL', 3, (p) => p.velo, (pad, v) => upd(pad, { velo: v })),
        num('A', 3, (p) => p.amp.attack, (pad, v) => upd(pad, { amp: { ...s.currentProgram.pads[pad]!.amp, attack: v } })),
        num('D', 3, (p) => p.amp.decay, (pad, v) => upd(pad, { amp: { ...s.currentProgram.pads[pad]!.amp, decay: v } })),
        num('S', 3, (p) => p.amp.sustain, (pad, v) => upd(pad, { amp: { ...s.currentProgram.pads[pad]!.amp, sustain: v } })),
        num('R', 3, (p) => p.amp.release, (pad, v) => upd(pad, { amp: { ...s.currentProgram.pads[pad]!.amp, release: v } })),
      ];
      case 'FILTER': {
        const fenv = (pad: number, k: keyof PadParams['filterEnv'], v: number) =>
          upd(pad, { filterEnv: { ...s.currentProgram.pads[pad]!.filterEnv, [k]: v } });
        return [
          padCol,
          {
            label: 'TYP', width: 3,
            text: (p) => p.filterType,
            wheel: (pad, _d, raw) => {
              const cur = s.currentProgram.pads[pad]!;
              const next = stepEnum(FILTERS, cur.filterType, raw);
              // Wechsel zwischen EQ (−100…100) und Filter (0–100): Frequenz in den gültigen Bereich holen
              const eq = next === 'EQL' || next === 'EQH';
              const freq = eq ? Math.max(-100, Math.min(100, cur.filterFreq)) : Math.max(0, cur.filterFreq);
              upd(pad, { filterType: next, filterFreq: eq && !(cur.filterType === 'EQL' || cur.filterType === 'EQH') ? 0 : freq });
            },
            copy: (from, to) => upd(to, { filterType: from.filterType }),
          },
          {
            label: 'FRQ', width: 4,
            text: (p) => String(p.filterFreq).padStart(4),
            wheel: (pad, d) => {
              const cur = s.currentProgram.pads[pad]!;
              const eq = cur.filterType === 'EQL' || cur.filterType === 'EQH';
              upd(pad, { filterFreq: step(cur.filterFreq, d, eq ? -100 : 0, 100) });
            },
            copy: (from, to) => upd(to, { filterFreq: from.filterFreq }),
          },
          num('RES', 3, (p) => p.filterReso, (pad, v) => upd(pad, { filterReso: v })),
          num('A', 3, (p) => p.filterEnv.attack, (pad, v) => fenv(pad, 'attack', v)),
          num('D', 3, (p) => p.filterEnv.decay, (pad, v) => fenv(pad, 'decay', v)),
          num('S', 3, (p) => p.filterEnv.sustain, (pad, v) => fenv(pad, 'sustain', v)),
          num('R', 3, (p) => p.filterEnv.release, (pad, v) => fenv(pad, 'release', v)),
          num('DPT', 3, (p) => p.filterDepth, (pad, v) => upd(pad, { filterDepth: v })),
          num('VEL', 3, (p) => p.filterVelo, (pad, v) => upd(pad, { filterVelo: v })),
        ];
      }
      case 'MUTE': {
        const target = (i: 0 | 1 | 2 | 3): Column => ({
          label: `T${i + 1}`, width: 3,
          text: (p) => { const t = p.targets[i]; return t === null || t === undefined ? '---' : padName(t); },
          wheel: (pad, _d, raw) => {
            const cur = s.currentProgram.pads[pad]!.targets;
            const t = cur[i];
            const next = t === null || t === undefined ? (raw > 0 ? 0 : null) : t + raw < 0 ? null : Math.min(63, t + raw);
            const arr = [...cur] as PadParams['targets'];
            arr[i] = next;
            upd(pad, { targets: arr });
          },
          copy: (from, to) => upd(to, { targets: [...from.targets] as PadParams['targets'] }),
        });
        return [
          padCol,
          {
            label: 'MODE', width: 7,
            text: (p) => p.muteMode.padEnd(7),
            wheel: (pad, _d, raw) => upd(pad, { muteMode: stepEnum(MUTE_MODES, s.currentProgram.pads[pad]!.muteMode, raw) }),
            copy: (from, to) => upd(to, { muteMode: from.muteMode }),
          },
          target(0), target(1), target(2), target(3),
          {
            label: 'GRP', width: 3,
            text: (p) => (p.muteGroup === 0 ? 'OFF' : pad3(p.muteGroup)),
            wheel: (pad, d) => upd(pad, { muteGroup: step(s.currentProgram.pads[pad]!.muteGroup, d, 0, 32) }),
            copy: (from, to) => upd(to, { muteGroup: from.muteGroup }),
          },
        ];
      }
      case 'OUT': return [
        padCol,
        num('LEV', 3, (p) => p.mixLevel, (pad, v) => upd(pad, { mixLevel: v })),
        {
          label: 'PAN', width: 3,
          text: (p) => formatPan(p.pan),
          wheel: (pad, d) => upd(pad, { pan: step(s.currentProgram.pads[pad]!.pan, d, -50, 50) }),
          copy: (from, to) => upd(to, { pan: from.pan }),
        },
        // Ausgänge und Effekte folgen mit Mixer (M5) und Effekten (M6)
        { label: 'OUT', width: 3, text: () => 'ST ' },
        { label: 'FX', width: 3, text: () => 'OFF' },
      ];
      case 'PITCH':
      case 'LFO':
        return [padCol];
    }
  }

  // ---------- Zeichnen ----------

  render(fb: FrameBuffer): void {
    fb.clear();
    const prog = this.store.currentProgram;
    const index = this.store.state.programs.indexOf(prog) + 1;
    fb.text(0, 0, 'Pgm:');
    fb.text(4 * CELL_W, 0, `${pad2(index)}-${prog.name}`.padEnd(19), this.onHeader);
    fb.text(25 * CELL_W, 0, '<DRUM>');
    fb.text(33 * CELL_W, 0, `Bank ${'ABCD'[this.ctx.ui.bank]}`);

    const cols = this.columns();
    if (this.page === 'PITCH' || this.page === 'LFO') {
      fb.text(0, 2 * CELL_H, `${this.page}: Tonhöhen-Hüllkurve und LFO`);
      fb.text(0, 3 * CELL_H, 'folgen in Meilenstein M9.');
      drawSoftkeys(fb, this.softkeys(), this.activeSoftkey());
      return;
    }
    // Kopfzeile der Tabelle
    let x = 0;
    const xs: number[] = [];
    for (const c of cols) { xs.push(x); fb.text(x * CELL_W, CELL_H, (c.right ? c.label.padStart(c.width) : c.label.padEnd(c.width)).slice(0, c.width)); x += c.width + 1; }
    fb.invertRect(0, CELL_H, LCD_W, CELL_H); // Spaltenköpfe hell auf dunkel

    // sichtbaren Ausschnitt so verschieben, dass das gewählte Pad sichtbar ist
    if (this.pad < this.top) this.top = this.pad;
    if (this.pad >= this.top + VISIBLE_ROWS) this.top = this.pad - VISIBLE_ROWS + 1;
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      const pad = this.top + r;
      const params = prog.pads[pad];
      if (!params) break;
      const y = (r + 2) * CELL_H;
      cols.forEach((c, ci) => {
        const sel = !this.onHeader && pad === this.pad && ci === this.col;
        fb.text(xs[ci]! * CELL_W, y, c.text(params, pad).slice(0, c.width), sel);
      });
      if (pad === this.pad && this.col !== 0) fb.fillRect(0, y + 7, 3 * CELL_W - 1, 1, true); // Markierung der Pad-Zeile
    }
    drawSoftkeys(fb, this.softkeys(), this.activeSoftkey());
  }

  // ---------- Bedienung ----------

  onEvent(e: HwEvent): boolean {
    const held = this.ctx.ui.held;
    const cols = this.columns();
    if (this.col >= cols.length) this.col = cols.length - 1;

    if (e.kind === 'pad' && e.down) {
      const target = this.ctx.ui.bank * 16 + e.pad;
      // UNDO SEQ gehalten + Pad: Wert unter dem Cursor auf das angeschlagene Pad kopieren (JJOS2XL)
      if (held.has('UNDO_SEQ')) {
        const c = cols[this.col];
        const from = this.store.currentProgram.pads[this.pad];
        if (c?.copy && from && target !== this.pad) { c.copy(from, target); this.ctx.flash(`${c.label} → ${padName(target)}`); }
        return true;
      }
      this.onHeader = false;
      return false; // Pad klingt; die App setzt selectedPad
    }

    if (e.kind === 'wheel') {
      const mult = this.ctx.coarse() ? 10 : 1;
      if (this.onHeader) {
        const list = this.store.state.programs;
        const i = list.findIndex((p) => p.id === this.pid);
        const next = list[step(i, e.delta, 0, list.length - 1)];
        if (next) this.store.setCurrentProgram(next.id);
        return true;
      }
      cols[this.col]?.wheel?.(this.pad, e.delta * mult, e.delta);
      return true;
    }

    if (e.kind !== 'button' || !e.down) return false;
    const shift = held.has('SHIFT');
    switch (e.id) {
      case 'F1': if (shift) return false; this.page = 'SAMPLE'; this.clampCol(); return true;
      case 'F2': if (shift) return false; this.page = 'AMP'; this.clampCol(); return true;
      case 'F3': if (shift) return false; this.page = 'FILTER'; this.clampCol(); return true;
      case 'F4': if (shift) return false; this.page = 'PITCH'; return true;
      case 'F5':
        if (shift && this.page === 'SAMPLE') {
          this.store.autoChromatic(this.pid, this.pad);
          this.ctx.flash(`Chromatisch ab ${padName(this.pad)}`);
          return true;
        }
        this.page = this.page === 'MUTE' ? 'LFO' : 'MUTE';
        this.clampCol();
        return true;
      case 'F6': if (shift) return false; this.page = 'OUT'; this.clampCol(); return true;
      case 'CURSOR_UP':
        if (shift) { this.onHeader = true; return true; }
        if (this.onHeader) return true;
        this.ctx.ui.selectedPad = step(this.pad, -1, 0, 63);
        return true;
      case 'CURSOR_DOWN':
        if (this.onHeader) { this.onHeader = false; return true; }
        this.ctx.ui.selectedPad = step(this.pad, 1, 0, 63);
        return true;
      case 'CURSOR_LEFT': if (!this.onHeader) this.col = Math.max(0, this.col - 1); return true;
      case 'CURSOR_RIGHT': if (!this.onHeader) this.col = Math.min(cols.length - 1, this.col + 1); return true;
      case 'WINDOW': {
        if (this.onHeader) { this.ctx.openWindow(new ProgramListWindow(this.ctx)); return true; }
        const w = cols[this.col]?.window?.(this.pad);
        if (w) this.ctx.openWindow(w);
        return true;
      }
    }
    return false;
  }

  private clampCol(): void {
    const n = this.columns().length;
    if (this.col >= n) this.col = n - 1;
  }
}

