import type { ButtonId, HwEvent } from '../../input/events';
import { FrameBuffer, LCD_W } from '../display/framebuffer';
import { drawSoftkeys, type Screen } from './screen';

/** Daten, die der M0-Diagnose-Screen anzeigt. Wird von außen aktualisiert. */
export interface DiagState {
  audio: 'aus' | 'startet' | 'läuft' | 'Fehler';
  sampleRate: number | null;
  baseMs: number | null;
  outputMs: number | null;
  blockMs: number | null;
  roundTripMs: number | null;
  roundTripNote: string;
  bank: 0 | 1 | 2 | 3;
  fullLevel: boolean;
  lastPad: string;
  lastVelocity: number | null;
  lastButton: string;
  wheel: number;
  sliders: [number, number];
  voices: number;
  message: string;
}

export function initialDiagState(): DiagState {
  return {
    audio: 'aus', sampleRate: null, baseMs: null, outputMs: null, blockMs: null,
    roundTripMs: null, roundTripNote: '', bank: 0, fullLevel: false, lastPad: '---', lastVelocity: null,
    lastButton: '---', wheel: 0, sliders: [0, 0], voices: 0, message: 'Pad antippen zum Testen',
  };
}

const fmt = (v: number | null, digits = 1) => (v === null ? '--' : v.toFixed(digits));

/**
 * M0: Diagnose statt Main-Screen. Zeigt Audio-Status, Latenz und die zuletzt
 * empfangenen Hardware-Ereignisse – so lässt sich jede Eingabeart prüfen.
 */
export class DiagScreen implements Screen {
  readonly id = 'diag';

  constructor(
    private state: DiagState,
    private actions: { measure(): void; allSoundOff(): void },
  ) {}

  softkeys(): readonly string[] {
    return ['MESSEN', '', '', '', '', 'STILLE'];
  }

  render(fb: FrameBuffer): void {
    const s = this.state;
    fb.clear();
    fb.text(1, 0, 'PADWERK 1K', false);
    fb.text(LCD_W - 6 * 12, 0, 'M0 DIAGNOSE', false);
    fb.invertRect(0, 0, LCD_W, 8);

    const sr = s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '';
    fb.textAt(0, 1, `Audio: ${s.audio} ${sr}`);
    fb.textAt(0, 2, `Latenz Basis ${fmt(s.baseMs)} Ausg. ${fmt(s.outputMs)} ms`);
    fb.textAt(0, 3, `Block ${fmt(s.blockMs)} ms  Round-Trip ${fmt(s.roundTripMs)} ms`);
    const bank = 'ABCD'[s.bank];
    const vel = s.lastVelocity === null ? '--' : String(s.lastVelocity);
    fb.textAt(0, 4, `Bank ${bank} Pad ${s.lastPad} Vel ${vel}${s.fullLevel ? ' FULL' : ''}`);
    fb.textAt(0, 5, `Taste ${s.lastButton.slice(0, 10)} Wheel ${s.wheel} Q ${s.sliders[0]}/${s.sliders[1]}`);
    fb.textAt(0, 6, `Stimmen ${s.voices}/32 ${s.message}`.slice(0, 40));
    drawSoftkeys(fb, this.softkeys());
  }

  onEvent(e: HwEvent): boolean {
    if (e.kind === 'button' && e.down) {
      const handlers: Partial<Record<ButtonId, () => void>> = {
        F1: () => this.actions.measure(),
        F6: () => this.actions.allSoundOff(),
      };
      const h = handlers[e.id];
      if (h) { h(); return true; }
    }
    return false;
  }
}
