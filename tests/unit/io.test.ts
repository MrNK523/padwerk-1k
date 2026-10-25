import { describe, expect, it } from 'vitest';
import { decodeAiff, isAiff, readExtended } from '../../src/io/aiff';
import { importAudio, rootNoteFromName } from '../../src/io/importAudio';
import { AudioFormatError, decodeWav, encodeWav16, isWav } from '../../src/io/wav';

function wav(format: number, bits: number, channels: number, rate: number, samples: number[]): ArrayBuffer {
  const bytes = bits / 8;
  const dataLen = samples.length * bytes;
  const buf = new ArrayBuffer(44 + dataLen + 10);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen + 10, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, format, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * bytes, true); v.setUint16(32, channels * bytes, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  samples.forEach((s, i) => {
    const o = 44 + i * bytes;
    if (format === 3) v.setFloat32(o, s, true);
    else if (bits === 16) v.setInt16(o, Math.round(s * 32767), true);
    else if (bits === 24) { const x = Math.round(s * 8388607) & 0xffffff; v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, x >> 16); }
    else if (bits === 8) v.setUint8(o, Math.round(s * 127 + 128));
  });
  // ein zusätzlicher Chunk ungerader Länge nach den Daten (muss übersprungen werden)
  str(44 + dataLen, 'LIST'); v.setUint16(48 + dataLen, 0, true);
  return buf;
}

function aiff(bits: number, channels: number, rate: number, samples: number[], compression?: string): ArrayBuffer {
  const bytes = bits / 8;
  const frames = samples.length / channels;
  const commLen = compression ? 24 : 18;
  const dataLen = samples.length * bytes;
  const total = 12 + 8 + commLen + 8 + 8 + dataLen;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'FORM'); v.setUint32(4, total - 8); str(8, compression ? 'AIFC' : 'AIFF');
  str(12, 'COMM'); v.setUint32(16, commLen);
  v.setInt16(20, channels); v.setUint32(22, frames); v.setInt16(26, bits);
  // 44100 als 80-Bit Extended
  const exp = 16383 + Math.floor(Math.log2(rate));
  v.setUint16(28, exp);
  v.setUint32(30, Math.round((rate / 2 ** Math.floor(Math.log2(rate))) * 2 ** 31));
  v.setUint32(34, 0);
  let o = 38;
  if (compression) { str(38, compression); v.setUint8(42, 0); v.setUint8(43, 0); o = 44; }
  str(o, 'SSND'); v.setUint32(o + 4, 8 + dataLen); v.setUint32(o + 8, 0); v.setUint32(o + 12, 0);
  const d = o + 16;
  const little = compression === 'sowt';
  samples.forEach((s, i) => v.setInt16(d + i * 2, Math.round(s * 32767), little));
  return buf;
}

describe('WAV', () => {
  it('liest 16-Bit-Stereo', () => {
    const a = decodeWav(wav(1, 16, 2, 44100, [0.5, -0.5, 0.25, -0.25]));
    expect(a.sampleRate).toBe(44100);
    expect(a.channels).toHaveLength(2);
    expect(a.channels[0]![0]).toBeCloseTo(0.5, 3);
    expect(a.channels[1]![1]).toBeCloseTo(-0.25, 3);
  });
  it('liest 24 Bit, 8 Bit und Float', () => {
    expect(decodeWav(wav(1, 24, 1, 48000, [0.75])).channels[0]![0]).toBeCloseTo(0.75, 4);
    expect(decodeWav(wav(1, 8, 1, 22050, [-0.5])).channels[0]![0]).toBeCloseTo(-0.5, 1);
    expect(decodeWav(wav(3, 32, 1, 96000, [0.123])).channels[0]![0]).toBeCloseTo(0.123, 5);
  });
  it('Schreiben und wieder Lesen ergibt dieselben Werte (16 Bit)', () => {
    const src = [new Float32Array([0, 0.5, -1, 1]), new Float32Array([0.1, -0.1, 0.2, -0.2])];
    const back = decodeWav(encodeWav16(src, 44100));
    expect(isWav(encodeWav16(src, 44100))).toBe(true);
    back.channels.forEach((ch, c) => ch.forEach((x, i) => expect(x).toBeCloseTo(src[c]![i]!, 3)));
  });
  it('lehnt Fremdes ab', () => {
    expect(() => decodeWav(new ArrayBuffer(20))).toThrow(AudioFormatError);
  });
});

describe('AIFF', () => {
  it('liest das 80-Bit-Samplerate-Feld', () => {
    const v = new DataView(aiff(16, 1, 44100, [0]));
    expect(readExtended(v, 28)).toBe(44100);
  });
  it('liest AIFF 16 Bit Big-Endian', () => {
    const buf = aiff(16, 2, 44100, [0.5, -0.5, 0.25, 0]);
    expect(isAiff(buf)).toBe(true);
    const a = decodeAiff(buf);
    expect(a.sampleRate).toBe(44100);
    expect(a.channels[0]![0]).toBeCloseTo(0.5, 3);
    expect(a.channels[1]![0]).toBeCloseTo(-0.5, 3);
    expect(a.channels[0]![1]).toBeCloseTo(0.25, 3);
  });
  it('liest AIFC „sowt“ (Little-Endian)', () => {
    const a = decodeAiff(aiff(16, 1, 48000, [0.3], 'sowt'));
    expect(a.sampleRate).toBe(48000);
    expect(a.channels[0]![0]).toBeCloseTo(0.3, 3);
  });
});

describe('Import', () => {
  it('WAV/AIFF ohne Browser, Rest über den Browser-Decoder', async () => {
    let called = 0;
    const fake = async () => { called++; return { numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(3) } as unknown as AudioBuffer; };
    await importAudio(wav(1, 16, 1, 44100, [0.1]), fake);
    await importAudio(aiff(16, 1, 44100, [0.1]), fake);
    expect(called).toBe(0);
    const mp3 = await importAudio(new ArrayBuffer(16), fake);
    expect(called).toBe(1);
    expect(mp3.sampleRate).toBe(48000);
  });
  it('erkennt den Grundton im Dateinamen (JJOS2XL „Auto set“)', () => {
    expect(rootNoteFromName('Piano D0.wav')).toBe(26);
    expect(rootNoteFromName('Piano_d0.wav')).toBe(26);
    expect(rootNoteFromName('Piano26.wav')).toBe(26);
    expect(rootNoteFromName('Bass C3.aif')).toBe(60);
    expect(rootNoteFromName('Kick hart.wav')).toBeNull();
  });
});
