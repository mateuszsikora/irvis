/** T7 host policy observed in the Android app; thresholds are not calibration limits. */
export class SensorRangePolicy {
  private settling = 100;
  private consecutive = 0;
  private gain: string | undefined;

  reset() {
    this.settling = 100;
    this.consecutive = 0;
    this.gain = undefined;
  }

  observe(gain: string, maximum: number): 'gain-high' | 'gain-low' | null {
    if (gain !== 'high' && gain !== 'low') {
      this.reset();
      return null;
    }
    if (this.gain !== gain) {
      this.reset();
      this.gain = gain;
    }
    if (this.settling > 0) {
      this.settling--;
      return null;
    }
    if (!Number.isFinite(maximum) || !(gain === 'high' ? maximum > 160 : maximum < 150)) {
      this.consecutive = 0;
      return null;
    }
    if (++this.consecutive < 100) return null;
    this.reset();
    return gain === 'high' ? 'gain-low' : 'gain-high';
  }
}
