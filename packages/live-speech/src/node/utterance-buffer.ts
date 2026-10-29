// Utterance accumulation and rolling-window slicing (r3 L3). Owns every sample
// count; the session only decides. Dropped on abandon — never retained, never logged.
import type { LocalSttProfile } from './profiles.js';

export function rmsDbfs(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

export class UtteranceBuffer {
  private counter = 0;
  private id: string | null = null;
  private samples: number[] = [];
  private buffered = 0;
  private silence = 0;
  private sinceDecode = 0;

  get utteranceId(): string | null { return this.id; }
  get utteranceOpen(): boolean { return this.id !== null; }
  get bufferedSamples(): number { return this.buffered; }
  get retainedSamples(): number { return this.samples.length; }
  get silenceSamples(): number { return this.silence; }
  get samplesSinceDecode(): number { return this.sinceDecode; }

  openUtterance(): string {
    this.counter += 1;
    this.id = `u${this.counter}`;
    this.samples = [];
    this.buffered = 0;
    this.silence = 0;
    this.sinceDecode = 0;
    return this.id;
  }

  push(pcm: Float32Array, speech: boolean): void {
    if (this.id === null) return;
    for (let i = 0; i < pcm.length; i++) this.samples.push(pcm[i]);
    this.buffered += pcm.length;
    this.sinceDecode += pcm.length;
    if (speech) this.silence = 0;
    else this.silence += pcm.length;
  }

  markDecoded(): void {
    this.sinceDecode = 0;
  }

  /**
   * Rolling decode window. Before any commit it trails the utterance head by
   * windowSec; after a commit it restarts at committedEnd - overlapSec so the
   * overlap is re-decoded and stitched, bounding every window by uncommitted
   * audio plus overlap instead of the whole utterance.
   */
  window(profile: LocalSttProfile, committedEnd: number): { window: Float32Array; endSample: number } {
    const rate = profile.sampleRateHz;
    let start: number;
    if (committedEnd < 0) {
      const windowSamples = Math.floor(profile.windowSec * rate);
      start = Math.max(0, this.samples.length - windowSamples);
    } else {
      const overlapSamples = Math.floor(profile.overlapSec * rate);
      const absoluteStart = this.buffered - this.samples.length;
      start = Math.max(absoluteStart, committedEnd - overlapSamples) - absoluteStart;
    }
    return { window: Float32Array.from(this.samples.slice(start)), endSample: this.buffered };
  }

  /** Snapshot for the endpoint decode; the caller abandons immediately after. */
  snapshot(): { audio: Float32Array; totalSamples: number } {
    return { audio: Float32Array.from(this.samples), totalSamples: this.buffered };
  }

  abandon(): void {
    this.id = null;
    this.samples = [];
    this.buffered = 0;
    this.silence = 0;
    this.sinceDecode = 0;
  }
}
