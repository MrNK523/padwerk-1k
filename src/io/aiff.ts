/**
 * AIFF/AIFC lesen (Big-Endian). Eigene Implementierung nach der öffentlichen Formatbeschreibung.
 * Unterstützt: PCM 8/16/24/32 Bit, AIFC „NONE“, „sowt“ (Little-Endian), „fl32“/„fl64“.
 */
import { AudioFormatError, type DecodedAudio, sampleReader } from './wav';

function fourcc(v: DataView, off: number): string {
  return String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
}

export function isAiff(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const v = new DataView(buf);
  const t = fourcc(v, 8);
  return fourcc(v, 0) === 'FORM' && (t === 'AIFF' || t === 'AIFC');
}

/** 80-Bit IEEE-754 Extended (Samplerate im COMM-Chunk). */
export function readExtended(v: DataView, off: number): number {
  const expon = v.getUint16(off) & 0x7fff;
  const sign = v.getUint16(off) & 0x8000 ? -1 : 1;
  const hi = v.getUint32(off + 2);
  const lo = v.getUint32(off + 6);
  if (expon === 0 && hi === 0 && lo === 0) return 0;
  const mant = hi * 2 ** -31 + lo * 2 ** -63;
  return sign * mant * 2 ** (expon - 16383);
}

export function decodeAiff(buf: ArrayBuffer): DecodedAudio {
  if (!isAiff(buf)) throw new AudioFormatError('Keine AIFF-Datei');
  const v = new DataView(buf);
  const aifc = fourcc(v, 8) === 'AIFC';
  let off = 12;
  let comm: { channels: number; frames: number; bits: number; rate: number; compression: string } | null = null;
  let ssnd = -1;
  let ssndLen = 0;
  while (off + 8 <= buf.byteLength) {
    const id = fourcc(v, off);
    const size = v.getUint32(off + 4);
    const body = off + 8;
    if (id === 'COMM') {
      comm = {
        channels: v.getInt16(body),
        frames: v.getUint32(body + 2),
        bits: v.getInt16(body + 6),
        rate: readExtended(v, body + 8),
        compression: aifc && size >= 22 ? fourcc(v, body + 18) : 'NONE',
      };
    } else if (id === 'SSND') {
      const dataOffset = v.getUint32(body);
      ssnd = body + 8 + dataOffset;
      ssndLen = Math.min(size - 8 - dataOffset, buf.byteLength - ssnd);
    }
    off = body + size + (size & 1);
  }
  if (!comm) throw new AudioFormatError('AIFF ohne COMM-Chunk');
  if (ssnd < 0) throw new AudioFormatError('AIFF ohne Daten');
  const comp = comm.compression.toLowerCase();
  let format = 1;
  let little = false;
  let bits = comm.bits;
  if (comp === 'sowt') little = true;
  else if (comp === 'fl32') { format = 3; bits = 32; }
  else if (comp === 'fl64') { format = 3; bits = 64; }
  else if (comp !== 'none') throw new AudioFormatError(`AIFC-Kompression „${comm.compression}“ nicht unterstützt`);

  const bytes = Math.ceil(bits / 8);
  const block = bytes * comm.channels;
  const frames = Math.min(comm.frames, Math.floor(ssndLen / block));
  const read = sampleReader(v, format, bytes * 8, little);
  const out = Array.from({ length: comm.channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < comm.channels; c++) out[c]![f] = read(ssnd + f * block + c * bytes);
  }
  return { sampleRate: comm.rate, channels: out };
}
