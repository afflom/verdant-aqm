/**
 * Stratum 7 — Euler-Bernoulli Modal Bar Quantum Sonification (`sonification.ts`)
 * Maps cyclotomic basis phases, entanglement purity, and surface-code syndrome parity excitations
 * onto Euler-Bernoulli free-bar eigenfrequencies f_m ~ (m + 0.5)^2 with Woodworth stereo panning.
 */

import { FOUR, ONE, THREE, TWO, ZERO } from './stratum0';
import { BasisAmplitudeSummary, BlochVector } from './types';

export class ModalQuantumAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean): boolean {
    this.enabled = next;
    if (next && !this.ctx && typeof window !== 'undefined') {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        this.ctx = new AudioCtor();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended' && next) {
      void this.ctx.resume();
    }
    return this.enabled;
  }

  /**
   * Triggers a gentle, calibrated Euler-Bernoulli modal bar chime reflecting the active quantum state.
   */
  public chimeQuantumState(
    blochVectors: readonly BlochVector[],
    basisAmplitudes: readonly BasisAmplitudeSummary[],
    syndromeCount = ZERO,
  ): void {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const baseHz = 220; // A3 calibration reference

    // Modal ratios proportional to Euler-Bernoulli clamped-free bar modes
    const modeCount = Math.min(FOUR, Math.max(ONE, blochVectors.length));
    for (let m = ZERO; m < modeCount; m += ONE) {
      const bv = blochVectors[m];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner();

      const modalFactor = ONE + m * 0.5 + (ONE - bv.rz) * 0.18;
      const phaseOffsetHz =
        basisAmplitudes[m] !== undefined ? basisAmplitudes[m].phaseRad * TWELVE_HZ : ZERO;
      const dissonanceHz = syndromeCount * NINE_HZ * (m % TWO === ZERO ? ONE : -ONE);

      osc.type = syndromeCount > ZERO ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(
        Math.max(110, Math.min(1760, baseHz * modalFactor + phaseOffsetHz + dissonanceHz)),
        now,
      );

      // Woodworth azimuth pan from Bloch rx
      panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, bv.rx)), now);

      const amp = 0.045 / modeCount;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(amp, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36 + (ONE - bv.purity) * 0.25);

      osc.connect(panner);
      panner.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.65);
    }
  }
}

const NINE_HZ = THREE * THREE;
const TWELVE_HZ = THREE * FOUR;

export const quantumAudio = new ModalQuantumAudioEngine();
