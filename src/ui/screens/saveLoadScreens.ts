/**
 * SAVE (MODE + PAD 3) und LOAD (MODE + PAD 2).
 * Statt Speicherkarte: Dateien auf dem Gerät (Dateidialog bzw. Download). Projektformat „.padwerk“, Samples als WAV.
 */
import { MAX_SEQUENCES } from '../../core/sequence';
import { encodeWav16 } from '../../io/wav';
import { encodeProject, FILE_EXT, safeFileName, type ProjectData } from '../../io/projectFile';
import type { HwEvent } from '../../input/events';
import { CELL_H, CELL_W } from '../display/font5x7';
import { LCD_W, type FrameBuffer } from '../display/framebuffer';
import { drawSoftkeys, drawWindowFrame, pad2, step, stepEnum, type AppCtx, type Screen } from './screen';
import { ConfirmWindow, NameWindow } from './sampleWindows';
import { Window } from './windows';

function title(fb: FrameBuffer, text: string, right = ''): void {
  fb.text(1, 0, text);
  if (right) fb.text(LCD_W - right.length * CELL_W - 1, 0, right);
  fb.invertRect(0, 0, LCD_W, CELL_H);
}

export const SAVE_TYPES = ['ENTIRE MEMORY', 'SEQUENCE', 'PROGRAM', 'SAMPLE'] as const;
type SaveType = (typeof SAVE_TYPES)[number];

const fmtSize = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} kB`);

export class SaveScreen implements Screen {
  readonly id = 'save';
  private type: SaveType = 'ENTIRE MEMORY';
  private row = 0;
  private seq = 0;
  private programIndex = 0;
  private sampleIndex = 0;
  private projectName = 'Projekt01';
  private busy = false;

  constructor(private ctx: AppCtx) {}

  onEnter(): void {
    const s = this.ctx.store.state;
    this.seq = s.currentSeq;
    this.programIndex = Math.max(0, s.programs.findIndex((p) => p.id === s.currentProgramId));
  }

  softkeys() { return ['NAME', '', '', '', '', 'DO IT']; }

  private item(): string {
    const store = this.ctx.store;
    switch (this.type) {
      case 'ENTIRE MEMORY': return '(alles)';
      case 'SEQUENCE': return `${pad2(this.seq + 1)}-${store.state.sequences[this.seq]?.name ?? '(unused)'}`;
      case 'PROGRAM': return store.state.programs[this.programIndex]?.name ?? '';
      case 'SAMPLE': return store.samplesSorted()[this.sampleIndex]?.name ?? '(keine)';
    }
  }

  private fileName(): string {
    const store = this.ctx.store;
    switch (this.type) {
      case 'ENTIRE MEMORY': return safeFileName(this.projectName, FILE_EXT);
      case 'SEQUENCE': return safeFileName(store.state.sequences[this.seq]?.name ?? 'Sequence', FILE_EXT);
      case 'PROGRAM': return safeFileName(store.state.programs[this.programIndex]?.name ?? 'Program', FILE_EXT);
      case 'SAMPLE': return safeFileName(store.samplesSorted()[this.sampleIndex]?.name ?? 'Sample', '.wav');
    }
  }

  private estimate(): number {
    const store = this.ctx.store;
    const bytesOf = (ids: Iterable<string>) => [...new Set(ids)].reduce((n, id) => {
      const m = store.sample(id);
      return n + (m ? m.frames * m.channels * 4 : 0);
    }, 0);
    switch (this.type) {
      case 'ENTIRE MEMORY': return bytesOf(store.state.samples.map((s) => s.id));
      case 'SEQUENCE': return 20000;
      case 'PROGRAM': {
        const p = store.state.programs[this.programIndex];
        return bytesOf(p?.pads.flatMap((pad) => pad.layers.map((l) => l.sampleId ?? '')) ?? []);
      }
      case 'SAMPLE': { const m = store.samplesSorted()[this.sampleIndex]; return m ? m.frames * m.channels * 2 : 0; }
    }
  }

  render(fb: FrameBuffer): void {
    fb.clear();
    title(fb, 'SPEICHERN', 'Datei auf dem Gerät');
    const rows: [string, string][] = [
      ['Typ:', this.type],
      ['Inhalt:', this.item()],
      ['Datei:', this.fileName()],
    ];
    rows.forEach(([l, v], i) => {
      fb.text(0, (i + 1) * CELL_H + 2, l);
      fb.text(8 * CELL_W, (i + 1) * CELL_H + 2, v.slice(0, 32), this.row === i);
    });
    const info = this.type === 'SAMPLE' ? 'WAV 16 Bit, Original-Samplerate' : 'Padwerk-Projektformat, verlustfrei';
    fb.text(0, 5 * CELL_H, info);
    fb.text(0, 6 * CELL_H, this.busy ? 'Speichere …' : `Größe ca. ${fmtSize(this.estimate())}`);
    drawSoftkeys(fb, this.softkeys());
  }

  onEvent(e: HwEvent): boolean {
    const store = this.ctx.store;
    if (e.kind === 'pad') {
      // Vorhören des gewählten Samples (JJOS2XL)
      const m = this.type === 'SAMPLE' ? store.samplesSorted()[this.sampleIndex] : undefined;
      if (e.down && m) this.ctx.audition(m.id, { start: m.start, end: m.end }, { gate: false, reverse: false, velocity: e.velocity });
      return this.type === 'SAMPLE';
    }
    if (e.kind === 'wheel') {
      const d = e.delta * (this.ctx.coarse() ? 10 : 1);
      if (this.row === 0) this.type = stepEnum(SAVE_TYPES, this.type, e.delta);
      else if (this.row === 1) {
        if (this.type === 'SEQUENCE') this.seq = step(this.seq, d, 0, MAX_SEQUENCES - 1);
        else if (this.type === 'PROGRAM') this.programIndex = step(this.programIndex, d, 0, store.state.programs.length - 1);
        else if (this.type === 'SAMPLE') this.sampleIndex = step(this.sampleIndex, d, 0, Math.max(0, store.state.samples.length - 1));
      }
      return true;
    }
    if (e.kind !== 'button' || !e.down) return false;
    switch (e.id) {
      case 'CURSOR_UP': this.row = Math.max(0, this.row - 1); return true;
      case 'CURSOR_DOWN': this.row = Math.min(2, this.row + 1); return true;
      case 'F1':
        if (this.type === 'ENTIRE MEMORY') this.ctx.openWindow(new NameWindow(this.ctx, 'Projektname', this.projectName, (n) => { this.projectName = n; }));
        else if (this.type === 'SEQUENCE') {
          const q = store.state.sequences[this.seq];
          if (q) this.ctx.openWindow(new NameWindow(this.ctx, 'Sequenzname', q.name, (n) => { store.ensureSequence(this.seq).name = n; store.touchSequence(this.seq); }));
        } else if (this.type === 'PROGRAM') {
          const p = store.state.programs[this.programIndex];
          if (p) this.ctx.openWindow(new NameWindow(this.ctx, 'Program-Name', p.name, (n) => store.renameProgram(p.id, n)));
        } else {
          const m = store.samplesSorted()[this.sampleIndex];
          if (m) this.ctx.openWindow(new NameWindow(this.ctx, 'Sample-Name', m.name, (n) => store.renameSample(m.id, n)));
        }
        return true;
      case 'F6': void this.doIt(); return true;
    }
    return false;
  }

  private async doIt(): Promise<void> {
    const store = this.ctx.store;
    let data: ArrayBuffer;
    let mime = 'application/octet-stream';
    if (this.type === 'SAMPLE') {
      const m = store.samplesSorted()[this.sampleIndex];
      const a = m && store.sampleAudio(m.id);
      if (!m || !a) { this.ctx.flash('Kein Sample gewählt'); return; }
      data = encodeWav16(a.channels, a.sampleRate);
      mime = 'audio/wav';
    } else {
      let p: ProjectData;
      if (this.type === 'SEQUENCE') p = store.exportProject('SEQUENCE', { seqIndex: this.seq });
      else if (this.type === 'PROGRAM') p = store.exportProject('PROGRAM', { programId: store.state.programs[this.programIndex]?.id });
      else p = store.exportProject('ALL');
      data = encodeProject(p);
    }
    this.busy = true;
    const name = this.fileName();
    try {
      const ok = await this.ctx.saveFile(name, data, mime);
      this.ctx.flash(ok ? `Gespeichert: ${name}` : 'Speichern abgebrochen');
    } catch (err) {
      console.warn(err);
      this.ctx.flash('Speichern fehlgeschlagen');
    } finally {
      this.busy = false;
    }
  }
}

/** LOAD (MODE + PAD 2): Audiodateien und Padwerk-Dateien vom Gerät laden. */
export class LoadScreen implements Screen {
  readonly id = 'load';
  constructor(private ctx: AppCtx, private opts: { assignToPad: boolean; lastLoaded: string[] }) {}
  softkeys() { return ['NEU', '', '', '', '', 'ÖFFNEN']; }
  render(fb: FrameBuffer): void {
    fb.clear();
    title(fb, 'LADEN', 'Datei vom Gerät');
    fb.text(0, CELL_H + 1, 'Pad zuweisen nach Laden:');
    fb.text(25 * CELL_W, CELL_H + 1, this.opts.assignToPad ? 'JA  ' : 'NEIN', true);
    fb.text(0, 2 * CELL_H + 1, 'Samples: WAV, AIFF, MP3 u. a.');
    fb.text(0, 3 * CELL_H + 1, `Projekte, Programs, Sequenzen: ${FILE_EXT}`);
    const last = this.opts.lastLoaded;
    fb.text(0, 4 * CELL_H + 1, `Im Speicher: ${this.ctx.store.state.samples.length} Samples, ${this.ctx.store.state.programs.length} Programs`);
    if (last.length) fb.text(0, 5 * CELL_H + 1, `Zuletzt: ${last.slice(-2).join(', ')}`.slice(0, 40));
    fb.text(0, 6 * CELL_H + 1, 'Tipp: Datei aufs Gerät ziehen');
    drawSoftkeys(fb, this.softkeys());
  }
  onEvent(e: HwEvent): boolean {
    if (e.kind === 'wheel') { this.opts.assignToPad = e.delta > 0; return true; }
    if (e.kind === 'button' && e.down && e.id === 'F6') { this.ctx.openFilePicker(); return true; }
    if (e.kind === 'button' && e.down && e.id === 'F1') {
      this.ctx.openWindow(new ConfirmWindow(this.ctx, 'Neues Projekt', 'Alles im Speicher löschen?', () => {
        this.ctx.store.newProject();
        this.ctx.flash('Neues Projekt');
      }));
      return true;
    }
    return false;
  }
}

/** Sequenz-Datei laden: Zielplatz wählen. */
export class LoadSequenceWindow extends Window {
  readonly id = 'load-seq';
  private target: number;
  constructor(ctx: AppCtx, private data: ProjectData) {
    super(ctx);
    const free = ctx.store.state.sequences.findIndex((q, i) => i > 0 && !q);
    this.target = free >= 0 ? free : ctx.store.state.currentSeq;
  }
  softkeys() { return ['', '', '', 'ABBR.', 'DO IT', '']; }
  render(fb: FrameBuffer): void {
    const { x, y } = drawWindowFrame(fb, 'Sequenz laden');
    fb.text(x, y, `Datei: ${this.data.sequences[0]?.name ?? ''}`);
    const cur = this.ctx.store.state.sequences[this.target];
    fb.text(x, y + 2 * CELL_H, 'Laden in Sq:');
    fb.text(x + 13 * CELL_W, y + 2 * CELL_H, `${pad2(this.target + 1)}-${cur?.name ?? '(unused)'}`.padEnd(20), true);
    drawSoftkeys(fb, this.softkeys());
  }
  protected handle(e: HwEvent): boolean {
    if (e.kind === 'wheel') { this.target = step(this.target, e.delta, 0, MAX_SEQUENCES - 1); return true; }
    if (e.kind !== 'button' || !e.down) return e.kind === 'pad';
    if (e.id === 'F4') { this.ctx.closeWindow(); return true; }
    if (e.id === 'F5') {
      this.ctx.store.loadSequenceInto(this.data, this.target);
      this.ctx.store.setCurrentSeq(this.target);
      this.ctx.closeWindow();
      this.ctx.flash(`Sequenz in Sq ${pad2(this.target + 1)} geladen`);
      return true;
    }
    return false;
  }
}
