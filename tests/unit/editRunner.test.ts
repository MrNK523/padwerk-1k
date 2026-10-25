import { describe, expect, it } from 'vitest';
import { defaultPlayback, equalChops, type SamplePlayback } from '../../src/core/model';
import { defaultEditParams, editResult, runEdit, type EditKind } from '../../src/dsp/editRunner';
import { bitConvert, combine, mix, normalize, reverse, ringMod } from '../../src/dsp/sampleEdit';
import { FrameBuffer } from '../../src/ui/display/framebuffer';
import { drawWave, maxZoom, viewAround } from '../../src/ui/display/waveform';

const ramp = (n: number) => [Float32Array.from({ length: n }, (_, i) => i)];
const run = (kind: EditKind, play: Partial<SamplePlayback>, range: [number, number], len = 100, chop = false) =>
  runEdit(kind, { channels: ramp(len), sampleRate: 1000, play: { ...defaultPlayback(len), ...play }, range, rangeIsChop: chop }, defaultEditParams());

describe('Edit-Ausführung', () => {
  it('DISCARD behält St–End, Punkte rücken nach vorn', () => {
    const r = run('DISCARD', { start: 20, end: 60, loopOn: true, loopPoint: 40 }, [20, 60]);
    expect(r.channels[0]!.length).toBe(40);
    expect(r.channels[0]![0]).toBe(20);
    expect([r.play.start, r.play.end, r.play.loopPoint]).toEqual([0, 40, 20]);
  });
  it('DELETE schneidet heraus, Start/Ende danach ganzes Sample (A-31)', () => {
    const r = run('DELETE', { start: 10, end: 30 }, [10, 30]);
    expect(r.channels[0]!.length).toBe(80);
    expect(r.channels[0]![10]).toBe(30);
    expect([r.play.start, r.play.end]).toEqual([0, 80]);
  });
  it('DELETE im Chop-Modus verschiebt die folgenden Chops', () => {
    const chops = equalChops(0, 100, 4);
    const r = run('DELETE', { chopOn: true, chops }, [25, 50], 100, true);
    expect(r.play.chops.map((c) => [c.start, c.end])).toEqual([[0, 25], [25, 25], [25, 50], [50, 75]]);
  });
  it('INSERT SILENCE: Stille am Start, Startpunkt bleibt', () => {
    const r = run('INSERT SILENCE', { start: 10, end: 50 }, [10, 50]);
    expect(r.channels[0]!.length).toBe(200); // 100 ms bei 1 kHz
    expect(r.channels[0]![10]).toBe(0);
    expect(r.channels[0]![110]).toBe(10);
    expect([r.play.start, r.play.end]).toEqual([10, 150]);
  });
  it('EXTRACT liefert nur den Bereich, ohne Chops', () => {
    const r = run('EXTRACT', { start: 5, end: 15, chopOn: true, chops: equalChops(0, 100) }, [5, 15]);
    expect(r.channels[0]!.length).toBe(10);
    expect(r.play.chopOn).toBe(false);
  });
  it('Übernahme-Art wie im Handbuch', () => {
    expect(editResult('DISCARD')).toBe('inplace');
    expect(editResult('SILENCE')).toBe('keepRetry');
    expect(editResult('EXTRACT')).toBe('newSample');
  });
});

describe('Weitere Bearbeitungen', () => {
  it('NORMALIZE und REVERSE optional nur im Bereich (Chop)', () => {
    const c = [new Float32Array([0.1, 0.2, 0.25, 0.5])];
    const n = normalize(c, 0, 2)[0]!;
    expect(n[1]).toBeCloseTo(0.9886, 3);
    expect(n[3]).toBeCloseTo(0.5);
    expect([...reverse(c, 1, 3)[0]!]).toEqual([0.1, 0.25, 0.2, 0.5].map(Math.fround));
  });
  it('BIT CONVERT quantisiert', () => {
    const r = bitConvert([new Float32Array([0.3, -0.7])], 2)[0]!;
    expect([...r]).toEqual([0.5, -0.5]);
  });
  it('RING MOD Mix 10 = nur Effekt', () => {
    const r = ringMod([new Float32Array(4).fill(1)], 4, { freq: 1, wave: 'SQUARE', mix: 10 })[0]!;
    expect([...r]).toEqual([1, 1, 1, -1]);
  });
  it('COMBINE hängt an (mit Umrechnung), MIX überlagert', () => {
    const a = [new Float32Array([1, 1])];
    const b = [new Float32Array([0.5, 0.5]), new Float32Array([0.5, 0.5])];
    expect([...combine(a, 1000, b, 1000)[0]!]).toEqual([1, 1, 0.5, 0.5]);
    expect(combine(a, 1000, b, 500)[0]!.length).toBe(6);
    expect([...mix(a, 1000, b, 1000, 100, 50)[0]!]).toEqual([1.25, 1.25]);
  });
});

describe('Wellenform', () => {
  it('Ausschnitt zentriert, am Rand begrenzt', () => {
    expect(viewAround(500, 1000, 0)).toEqual({ from: 0, to: 1000 });
    expect(viewAround(500, 1000, 1)).toEqual({ from: 250, to: 750 });
    expect(viewAround(990, 1000, 2)).toEqual({ from: 750, to: 1000 });
    expect(maxZoom(48000, 240)).toBe(Math.ceil(Math.log2(800)));
  });
  it('zeichnet innerhalb der Auswahl durchgezogen, außerhalb punktiert', () => {
    const fb = new FrameBuffer();
    const c = Float32Array.from({ length: 240 }, (_, i) => (i % 2 ? 1 : -1));
    drawWave(fb, c, { x: 0, y: 0, w: 240, h: 21 }, { from: 0, to: 240 }, { sel: [120, 240] });
    const col = (x: number) => Array.from({ length: 21 }, (_, y) => fb.get(x, y)).join('');
    expect(col(200)).toBe('1'.repeat(21));
    expect(col(10)).toMatch(/^(10)+1$|^(01)+0$/);
  });
});
