/**
 * Eigenes Dateiformat „.padwerk“ – rein, ohne Browser-API (nur ArrayBuffer/TextEncoder).
 *
 * Aufbau (alle Zahlen little-endian):
 *   0  4 Bytes  Kennung „PWK1“
 *   4  u32      Länge des JSON-Kopfs in Bytes
 *   8  …        JSON (UTF-8), danach Füllbytes bis zur nächsten 4-Byte-Grenze
 *   …           Audiodaten: je Sample, je Kanal `frames` × float32 (verlustfrei, Original-Samplerate)
 *
 * Der Kopf enthält Art (ALL, PROGRAM, SEQUENCE), Metadaten der Samples, Programs, Sequenzen und Einstellungen.
 */
import type { DrumProgram, SampleMeta } from '../core/model';
import type { Sequence } from '../core/sequence';
import type { SeqSettings } from '../core/sequencerCore';

export const FILE_EXT = '.padwerk';
export const FORMAT_VERSION = 1;
const MAGIC = 'PWK1';

export type ProjectKind = 'ALL' | 'PROGRAM' | 'SEQUENCE';

export interface ProjectSample {
  meta: SampleMeta;
  channels: Float32Array[];
}

export interface ProjectData {
  kind: ProjectKind;
  samples: ProjectSample[];
  programs: DrumProgram[];
  /** Länge 99 bei ALL (null = ungenutzt); bei SEQUENCE genau eine */
  sequences: (Sequence | null)[];
  currentProgramId?: string;
  currentSeq?: number;
  activeTrack?: number;
  seqSettings?: SeqSettings;
}

interface Header extends Omit<ProjectData, 'samples'> {
  format: typeof MAGIC;
  version: number;
  samples: SampleMeta[];
}

export class ProjectFormatError extends Error {}

export function isProjectFile(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 8) return false;
  return String.fromCharCode(...new Uint8Array(buf, 0, 4)) === MAGIC;
}

export function encodeProject(p: ProjectData): ArrayBuffer {
  const header: Header = {
    format: MAGIC, version: FORMAT_VERSION, kind: p.kind,
    samples: p.samples.map((s) => ({ ...s.meta, channels: s.channels.length === 2 ? 2 : 1, frames: s.channels[0]?.length ?? 0 })),
    programs: p.programs, sequences: p.sequences,
    currentProgramId: p.currentProgramId, currentSeq: p.currentSeq, activeTrack: p.activeTrack, seqSettings: p.seqSettings,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headLen = 8 + json.length;
  const audioStart = Math.ceil(headLen / 4) * 4;
  let audioBytes = 0;
  for (const s of p.samples) for (const c of s.channels.slice(0, 2)) audioBytes += c.length * 4;
  const buf = new ArrayBuffer(audioStart + audioBytes);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
  new DataView(buf).setUint32(4, json.length, true);
  u8.set(json, 8);
  let off = audioStart;
  for (const s of p.samples) {
    for (const c of s.channels.slice(0, 2)) {
      new Float32Array(buf, off, c.length).set(c);
      off += c.length * 4;
    }
  }
  return buf;
}

export function decodeProject(buf: ArrayBuffer): ProjectData {
  if (!isProjectFile(buf)) throw new ProjectFormatError('keine Padwerk-Datei');
  const len = new DataView(buf).getUint32(4, true);
  if (8 + len > buf.byteLength) throw new ProjectFormatError('Datei unvollständig');
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as Header;
  } catch {
    throw new ProjectFormatError('Kopf beschädigt');
  }
  if (header.version > FORMAT_VERSION) throw new ProjectFormatError('Datei aus neuerer Version');
  let off = Math.ceil((8 + len) / 4) * 4;
  const samples: ProjectSample[] = header.samples.map((meta) => {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < meta.channels; ch++) {
      const bytes = meta.frames * 4;
      if (off + bytes > buf.byteLength) throw new ProjectFormatError('Audiodaten unvollständig');
      channels.push(new Float32Array(buf.slice(off, off + bytes)));
      off += bytes;
    }
    return { meta, channels };
  });
  return {
    kind: header.kind, samples, programs: header.programs, sequences: header.sequences,
    currentProgramId: header.currentProgramId, currentSeq: header.currentSeq, activeTrack: header.activeTrack, seqSettings: header.seqSettings,
  };
}

/** Dateiname für den Download: nur unproblematische Zeichen. */
export function safeFileName(name: string, ext: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9ÄÖÜäöüß _.-]/g, '_').replace(/\s+/g, '_') || 'Padwerk';
  return base + ext;
}
