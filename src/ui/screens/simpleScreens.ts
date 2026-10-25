import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import { FrameBuffer, LCD_W } from '../display/framebuffer';
import { type AppCtx, type Screen, drawSoftkeys, pad2 } from './screen';

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

/** LOAD (MODE + PAD 2) – M1: Audiodateien vom Gerät laden. Projekte laden folgt mit SAVE in M4. */
export class LoadScreen implements Screen {
  readonly id = 'load';
  constructor(private ctx: AppCtx, private opts: { assignToPad: boolean; lastLoaded: string[] }) {}
  softkeys() { return ['', '', '', '', '', 'ÖFFNEN']; }
  render(fb: FrameBuffer): void {
    fb.clear();
    title(fb, 'LADEN', 'Audiodateien');
    fb.text(0, CELL_H + 1, 'Pad zuweisen nach Laden:');
    fb.text(25 * CELL_W, CELL_H + 1, this.opts.assignToPad ? 'JA  ' : 'NEIN', true);
    fb.text(0, 2 * CELL_H + 1, 'WAV, AIFF, MP3 und weitere Formate');
    const last = this.opts.lastLoaded;
    fb.text(0, 3 * CELL_H + 1, `Im Speicher: ${this.ctx.store.state.samples.length} Samples`);
    if (last.length) fb.text(0, 4 * CELL_H + 1, `Zuletzt: ${last.slice(-2).join(', ')}`.slice(0, 40));
    fb.text(0, 5 * CELL_H + 1, 'Tipp: Datei auf ein Pad ziehen');
    drawSoftkeys(fb, this.softkeys());
  }
  onEvent(e: HwEvent): boolean {
    if (e.kind === 'wheel') { this.opts.assignToPad = e.delta > 0; return true; }
    if (e.kind === 'button' && e.down && e.id === 'F6') { this.ctx.openFilePicker(); return true; }
    return false;
  }
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
