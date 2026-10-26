// Stable-prefix hypothesis reconciliation (r3 L3). Pure policy: overlapping window
// decodes collapse into full-hypothesis revisions that replace, never duplicated
// overlap. Transient wobble below the confirmed prefix is held, never shrunk.
import type { SttTranscription } from './engine-port.js';

/** Audible text of a transcription, or null when nothing is usable. */
export function usableText(transcription: SttTranscription): string | null {
  const text = transcription.segments
    .filter((segment) => segment.noSpeechProb < 0.6)
    .map((segment) => segment.text.trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
  return text.length > 0 ? text : null;
}

export interface ReconciledPartial {
  readonly text: string;
  readonly revision: number;
  readonly replaces: { start: number; end: number };
}

export class HypothesisTracker {
  private revision = 0;
  private hypothesis = '';
  private stablePrefix = '';
  private previousDecodeText: string | null = null;
  private appliedWindowEnd = -1;

  reset(): void {
    this.revision = 0;
    this.hypothesis = '';
    this.stablePrefix = '';
    this.previousDecodeText = null;
    this.appliedWindowEnd = -1;
  }

  /**
   * Fold one window decode into the hypothesis. Returns the partial to emit, or
   * null when the decode is stale, silent, identical, or below the stable prefix.
   */
  applyWindow(endSample: number, text: string | null): ReconciledPartial | null {
    if (endSample <= this.appliedWindowEnd) return null;
    this.appliedWindowEnd = endSample;
    if (text === null) {
      this.previousDecodeText = null;
      return null;
    }
    if (this.previousDecodeText !== null && text === this.previousDecodeText) {
      this.stablePrefix = text;
    }
    this.previousDecodeText = text;
    if (!text.startsWith(this.stablePrefix) || text === this.hypothesis) return null;
    const replaces = { start: 0, end: this.hypothesis.length };
    this.hypothesis = text;
    this.revision += 1;
    return { text, revision: this.revision, replaces };
  }
}
