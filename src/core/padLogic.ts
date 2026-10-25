/**
 * Logik eines Pad-Anschlags – rein, ohne Audio. Entscheidet, welche Layer klingen,
 * welche Stimmen abgeschnitten werden (Mute-Gruppen, Mute-Ziele, Mono) und welche Pads mitklingen (Simult).
 * Quelle: JJOS2XL-Handbuch, Abschnitt MUTE/Simult Pad.
 */
import type { DrumProgram, Layer, PadParams } from './model';

/** Layer, die bei dieser Velocity klingen (Sample vorhanden und Velocity im Bereich). */
export function layersFor(pad: PadParams, velocity: number): { index: 0 | 1 | 2; layer: Layer }[] {
  const out: { index: 0 | 1 | 2; layer: Layer }[] = [];
  pad.layers.forEach((layer, i) => {
    if (layer.sampleId && velocity >= layer.rangeLo && velocity <= layer.rangeHi) out.push({ index: i as 0 | 1 | 2, layer });
  });
  return out;
}

/**
 * Pads, deren klingende Stimmen beim Anschlag von `pad` gestoppt werden:
 * - gleiche Mute-Gruppe (≠ 0), außer dem Pad selbst
 * - Mute-Ziele (TARGT) im Modus MUTE
 * - das Pad selbst bei Voice Overlap MONO
 */
export function padsToCut(program: DrumProgram, pad: number): Set<number> {
  const p = program.pads[pad];
  const cut = new Set<number>();
  if (!p) return cut;
  if (p.muteGroup > 0) {
    program.pads.forEach((other, i) => { if (i !== pad && other.muteGroup === p.muteGroup) cut.add(i); });
  }
  if (p.muteMode === 'MUTE') for (const t of p.targets) if (t !== null && t !== pad) cut.add(t);
  if (p.voice === 'MONO') cut.add(pad);
  return cut;
}

/**
 * Pads, die mit `pad` zusammen erklingen (SIMULT1/SIMULT2).
 * SIMULT1 nimmt die Ziel-Pads beim Aufnehmen mit auf, SIMULT2 spielt sie erst bei der Wiedergabe –
 * live klingen beide gleich. Eine Kette wird nicht weiterverfolgt (nur direkte Ziele).
 */
export function simultTargets(program: DrumProgram, pad: number): number[] {
  const p = program.pads[pad];
  if (!p || p.muteMode === 'MUTE') return [];
  return p.targets.filter((t): t is number => t !== null && t !== pad);
}
