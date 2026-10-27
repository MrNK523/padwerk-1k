import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import { FrameBuffer, LCD_W } from '../display/framebuffer';
import { type Screen, drawSoftkeys, pad2 } from './screen';

function title(fb: FrameBuffer, text: string, right = ''): void {
  fb.text(1, 0, text);
  if (right) fb.text(LCD_W - right.length * CELL_W - 1, 0, right);
  fb.invertRect(0, 0, LCD_W, CELL_H);
}

/** Modi, die noch nicht gebaut sind: zeigt Name und Meilenstein. */
export class PlaceholderScreen implements Screen {
  constructor(readonly id: string, private name: string, private milestone: string) {}
  softkeys() { return ['', '', '', '', '', '']; }
  render(fb: FrameBuffer): void {
    fb.clear();
    title(fb, this.name);
    fb.text(0, 2 * CELL_H, `${this.name} folgt in Meilenstein ${this.milestone}.`);
    fb.text(0, 4 * CELL_H, 'MAIN führt zurück.');
    drawSoftkeys(fb, this.softkeys());
  }
  onEvent(_e: HwEvent): boolean { return false; }
}

export const MODE_PADS: readonly { name: string; short: string; milestone: string; lcd?: string }[] = [
  { name: 'Q-LINK', short: 'Q-LINK', milestone: 'M5' },
  { name: 'LADEN', short: 'LOAD', milestone: 'M1' },
  { name: 'SPEICHERN', short: 'SAVE', milestone: 'M4' },
  { name: 'TRACK MIXER', short: 'TR.MIX', milestone: 'M5' },
  { name: 'AUFNAHME', short: 'RECORD', milestone: 'M7' },
  { name: 'TRIM', short: 'TRIM', milestone: 'M3' },
  { name: 'PROGRAM', short: 'PROGRAM', milestone: 'M1', lcd: 'PROGRM' },
  { name: 'PAD MIXER', short: 'MIXER', milestone: 'M5' },
  { name: 'MIDI/SYNC', short: 'MIDI', milestone: 'M8' },
  { name: 'OTHER', short: 'OTHER', milestone: 'M1' },
  { name: 'LOOPER', short: 'LOOPER', milestone: 'M7' },
  { name: 'EFFEKTE', short: 'EFFECT', milestone: 'M6' },
  { name: 'SEQ EDIT', short: 'SEQ.ED', milestone: 'M5' },
  { name: 'STEP EDIT', short: 'STEP', milestone: 'M4' },
  { name: 'GRID EDIT', short: 'GRID', milestone: 'M4' },
  { name: 'SONG', short: 'SONG', milestone: 'M5' },
];

/** Anzeige während MODE blinkt: welches Pad welchen Modus öffnet. */
export class ModeSelectOverlay implements Screen {
  readonly id = 'mode-select';
  softkeys() { return ['', '', '', '', '', '']; }
  render(fb: FrameBuffer): void {
    fb.clear();
    title(fb, 'MODUS WÄHLEN', 'Pad anschlagen');
    // 4 × 4 wie die Pads: oberste Reihe = Pads 13–16
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const pad = (3 - row) * 4 + col;
        const m = MODE_PADS[pad]!;
        const x = col * 60;
        const y = CELL_H + 4 + row * 12;
        fb.text(x + 1, y, `${pad2(pad + 1)} ${m.lcd ?? m.short}`.slice(0, 9));
      }
    }
  }
  onEvent(_e: HwEvent): boolean { return false; }
}
