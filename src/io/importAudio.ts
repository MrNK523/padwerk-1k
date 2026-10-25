import { decodeAiff, isAiff } from './aiff';
import { AudioFormatError, decodeWav, isWav, type DecodedAudio } from './wav';

export const ACCEPTED_AUDIO = '.wav,.wave,.aif,.aiff,.aifc,.mp3,.m4a,.ogg,.flac,audio/*';

/**
 * Datei → Audiodaten. WAV und AIFF lesen wir selbst (verlustfrei, Original-Samplerate,
 * gleiches Ergebnis in jedem Browser); alles andere dekodiert der Browser.
 */
export async function importAudio(
  data: ArrayBuffer,
  browserDecode: (buf: ArrayBuffer) => Promise<AudioBuffer>,
): Promise<DecodedAudio> {
  try {
    if (isWav(data)) return limitChannels(decodeWav(data));
    if (isAiff(data)) return limitChannels(decodeAiff(data));
  } catch (err) {
    // Exotische Varianten (z. B. komprimiertes WAV) dem Browser überlassen
    if (!(err instanceof AudioFormatError)) throw err;
  }
  const ab = await browserDecode(data.slice(0));
  const channels = Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, i) => ab.getChannelData(i).slice());
  return { sampleRate: ab.sampleRate, channels };
}

/** Mehr als zwei Kanäle: nur die ersten beiden behalten (Gerät kennt nur Mono/Stereo). */
function limitChannels(a: DecodedAudio): DecodedAudio {
  return a.channels.length > 2 ? { ...a, channels: a.channels.slice(0, 2) } : a;
}

/** Grundton aus dem Dateinamen (JJOS2XL „Auto set“): „Piano_D0“, „Piano 26“ … – sonst null. */
export function rootNoteFromName(name: string): number | null {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, '');
  const m = /([A-Ga-g])(#|b)?(-?\d)$/.exec(base);
  if (m) {
    const steps: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const n = steps[m[1]!.toLowerCase()]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    // JJOS2XL: C_3 = Note 60
    return (Number(m[3]) + 2) * 12 + n;
  }
  const num = /(\d{2,3})$/.exec(base);
  if (num) {
    const v = Number(num[1]);
    if (v >= 0 && v <= 127) return v;
  }
  return null;
}
