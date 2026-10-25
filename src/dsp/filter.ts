/**
 * 2-Pol-Filter als Zustandsvariablen-Filter in TPT-Form (topologieerhaltende Transformation,
 * öffentlich beschrieben in V. Zavalishin, „The Art of VA Filter Design“). Eigene Implementierung.
 * Stabil auch bei schneller Modulation – wichtig für Filter-Hüllkurven.
 */

export type SvfMode = 'LP' | 'BP' | 'HP' | 'LS' | 'HS';

export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1.414;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  mode: SvfMode = 'LP';
  /** Verstärkung für Shelving (linear). */
  shelfGain = 1;

  setParams(cutoffHz: number, q: number, sampleRate: number): void {
    const fc = Math.min(cutoffHz, sampleRate * 0.49);
    this.g = Math.tan((Math.PI * fc) / sampleRate);
    this.k = 1 / Math.max(0.1, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }

  reset(): void {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    const lp = v2;
    const bp = v1;
    switch (this.mode) {
      case 'LP': return lp;
      case 'BP': return bp;
      case 'HP': return x - this.k * bp - lp;
      case 'LS': return x + (this.shelfGain - 1) * lp;
      case 'HS': return x + (this.shelfGain - 1) * (x - this.k * bp - lp);
    }
  }
}
