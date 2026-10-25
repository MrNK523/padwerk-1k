/**
 * WAV lesen und schreiben (RIFF/WAVE). Eigene Implementierung nach der öffentlichen Formatbeschreibung.
 * Lesen: PCM 8/16/24/32 Bit, Float 32/64 Bit, WAVE_FORMAT_EXTENSIBLE.
 */

export interface DecodedAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export class AudioFormatError extends Error {}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(v: DataView, off: number): string {
  return String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
}

export function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const v = new DataView(buf);
  return fourcc(v, 0) === 'RIFF' && fourcc(v, 8) === 'WAVE';
}

export function decodeWav(buf: ArrayBuffer): DecodedAudio {
  if (!isWav(buf)) throw new AudioFormatError('Keine WAV-Datei');
  const v = new DataView(buf);
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number; blockAlign: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.byteLength) {
    const id = fourcc(v, off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      const channels = v.getUint16(body + 2, true);
      const rate = v.getUint32(body + 4, true);
      const blockAlign = v.getUint16(body + 12, true);
      const bits = v.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 40) format = v.getUint16(body + 24, true);
      fmt = { format, channels, rate, bits, blockAlign };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, buf.byteLength - body);
    }
    off = body + size + (size & 1); // Chunks sind auf gerade Länge aufgefüllt
  }
  if (!fmt) throw new AudioFormatError('WAV ohne fmt-Chunk');
  if (dataOff < 0) throw new AudioFormatError('WAV ohne Daten');
  const { format, channels, rate, bits, blockAlign } = fmt;
  if (channels < 1) throw new AudioFormatError('WAV ohne Kanäle');
  const bytes = bits / 8;
  if (blockAlign !== bytes * channels) throw new AudioFormatError('WAV-Blockgröße unbekannt');
  const frames = Math.floor(dataLen / blockAlign);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));

  const read = sampleReader(v, format, bits, true);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) out[c]![f] = read(dataOff + f * blockAlign + c * bytes);
  }
  return { sampleRate: rate, channels: out };
}

/** Liefert eine Lesefunktion für ein einzelnes Sample (Wert −1…1). */
export function sampleReader(v: DataView, format: number, bits: number, little: boolean): (off: number) => number {
  if (format === FORMAT_FLOAT) {
    if (bits === 32) return (o) => v.getFloat32(o, little);
    if (bits === 64) return (o) => v.getFloat64(o, little);
  }
  if (format === FORMAT_PCM) {
    switch (bits) {
      case 8: return little ? (o) => (v.getUint8(o) - 128) / 128 : (o) => v.getInt8(o) / 128; // WAV: unsigned, AIFF: signed
      case 16: return (o) => v.getInt16(o, little) / 32768;
      case 24: return (o) => {
        const b0 = v.getUint8(o), b1 = v.getUint8(o + 1), b2 = v.getUint8(o + 2);
        let x = little ? b0 | (b1 << 8) | (b2 << 16) : b2 | (b1 << 8) | (b0 << 16);
        if (x & 0x800000) x -= 0x1000000;
        return x / 8388608;
      };
      case 32: return (o) => v.getInt32(o, little) / 2147483648;
    }
  }
  throw new AudioFormatError(`Format ${format}/${bits} Bit nicht unterstützt`);
}

/** 16-Bit-PCM-WAV schreiben (für Export/Mixdown). */
export function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataLen = frames * nch * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, FORMAT_PCM, true); v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * 2, true); v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![f]!));
      v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      o += 2;
    }
  }
  return buf;
}
