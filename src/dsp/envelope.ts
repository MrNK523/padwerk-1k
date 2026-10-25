/**
 * ADSR-Hüllkurve, per Sample getaktet. Rein, ohne Browser-API.
 * Attack linear, Decay und Release exponentiell (−40 dB am Ende der eingestellten Zeit).
 */

export type EnvStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';

export interface EnvSettings {
  attackFrames: number;
  decayFrames: number;
  /** 0–1 */
  sustain: number;
  releaseFrames: number;
}

const FLOOR = 0.0001; // −80 dB: darunter gilt die Hüllkurve als beendet

export class Adsr {
  stage: EnvStage = 'idle';
  level = 0;
  private attackStep = 0;
  private decayCoef = 0;
  private releaseCoef = 0;
  private sustain = 1;

  trigger(s: EnvSettings): void {
    this.sustain = Math.min(1, Math.max(0, s.sustain));
    this.decayCoef = s.decayFrames > 0 ? Math.exp(Math.log(0.01) / s.decayFrames) : 0;
    this.releaseCoef = s.releaseFrames > 0 ? Math.exp(Math.log(0.01) / s.releaseFrames) : 0;
    if (s.attackFrames > 0) {
      this.stage = 'attack';
      // Neustart aus dem aktuellen Pegel (gestohlene/retriggerte Stimme knackt nicht)
      this.attackStep = (1 - this.level) / s.attackFrames;
      if (this.attackStep <= 0) this.attackStep = 1 / s.attackFrames;
    } else {
      this.level = 1;
      this.stage = 'decay';
    }
  }

  release(): void {
    if (this.stage === 'idle' || this.stage === 'release') return;
    this.stage = 'release';
  }

  /** Setzt die Release-Zeit neu (z. B. ONE SHOT: Ausblenden zum Sample-Ende). */
  setReleaseFrames(frames: number): void {
    this.releaseCoef = frames > 0 ? Math.exp(Math.log(0.01) / frames) : 0;
  }

  next(): number {
    switch (this.stage) {
      case 'attack':
        this.level += this.attackStep;
        if (this.level >= 1) { this.level = 1; this.stage = 'decay'; }
        break;
      case 'decay':
        if (this.decayCoef === 0) { this.level = this.sustain; this.stage = 'sustain'; break; }
        // exponentiell auf den Sustain-Pegel zu
        this.level = this.sustain + (this.level - this.sustain) * this.decayCoef;
        if (Math.abs(this.level - this.sustain) < FLOOR) { this.level = this.sustain; this.stage = 'sustain'; }
        break;
      case 'sustain':
        this.level = this.sustain;
        break;
      case 'release':
        this.level = this.releaseCoef === 0 ? 0 : this.level * this.releaseCoef;
        if (this.level < FLOOR) { this.level = 0; this.stage = 'idle'; }
        break;
      case 'idle':
        this.level = 0;
        break;
    }
    if (this.stage === 'sustain' && this.sustain === 0) { this.level = 0; this.stage = 'idle'; }
    return this.level;
  }

  get done(): boolean {
    return this.stage === 'idle';
  }
}
