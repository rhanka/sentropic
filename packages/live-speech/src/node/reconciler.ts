// Stable-hypothesis reconciliation (r3 L3). Every emission commits text with its
// sample offset; the next window starts at committedEnd - overlapSec and the
// overlap is deduped by longest suffix/prefix stitching against the commit.
// Regressions, repeats and lost-continuity windows are held, never shrink the
// committed text. Stale windows resolve to nothing via the end-sample guard.
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

/**
 * Word-anchored overlap: longest leading run of `candidate` words that matches
 * trailing `committed` words, returned as a character count. A single shared
 * character across a word boundary (e.g. 'I like it' + 'the dog' sharing 't')
 * never matches a whole word, so it can never stitch ('ithe dog' is impossible).
 */
function overlapLength(committed: string, candidate: string): number {
  const head = committed.split(/\s+/).filter((word) => word.length > 0);
  const tail = candidate.split(/\s+/).filter((word) => word.length > 0);
  const maxWords = Math.min(head.length, tail.length);
  for (let words = maxWords; words >= 1; words--) {
    let match = true;
    for (let i = 0; i < words; i++) {
      if (head[head.length - words + i] !== tail[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Character length of the overlapping word run plus the single separator
      // that joins it to the remainder (the committed head carries no trailing
      // space, so the merge re-adds exactly one).
      const prefix = tail.slice(0, words).join(' ');
      return candidate.length > prefix.length ? prefix.length + 1 : prefix.length;
    }
  }
  return 0;
}

export class HypothesisTracker {
  private revision = 0;
  private committed = '';
  private committedEnd = -1;
  private appliedWindowEnd = -1;

  reset(): void {
    this.revision = 0;
    this.committed = '';
    this.committedEnd = -1;
    this.appliedWindowEnd = -1;
  }

  /** Sample offset the next window starts from (committed text end, unset at first). */
  get committedEndSample(): number {
    return this.committedEnd;
  }

  /**
   * Fold one window decode into the committed hypothesis. Returns the partial to
   * emit, or null when the decode is stale, silent, already committed, regressed,
   * or has lost continuity with the commit.
   */
  applyWindow(endSample: number, text: string | null): ReconciledPartial | null {
    if (endSample <= this.appliedWindowEnd) return null;
    this.appliedWindowEnd = endSample;
    if (text === null || text.length === 0) return null;
    if (this.committedEnd < 0) {
      // Head mode: nothing committed yet — the first usable decode commits the head.
      const replaces = { start: 0, end: 0 };
      this.committed = text;
      this.committedEnd = endSample;
      this.revision += 1;
      return { text, revision: this.revision, replaces };
    }
    const strip = overlapLength(this.committed, text);
    if (strip === text.length) return null;
    if (strip === 0) return null;
    // The overlap strips the shared word run plus its joining separator; the
    // committed head carries no trailing space, so the merge re-adds exactly one.
    const replaces = { start: 0, end: this.committed.length };
    this.committed += ` ${text.slice(strip)}`;
    this.committedEnd = endSample;
    this.revision += 1;
    return { text: this.committed, revision: this.revision, replaces };
  }
}
