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
 * Real engine output varies in case and punctuation across windows ('Quick' vs
 * 'quick', 'brown,' vs 'brown'), so words compare normalized: lowercased with
 * surrounding punctuation stripped. The returned count is measured on the raw
 * candidate (offsets preserved), so the merge keeps the engine's own text.
 */
function splitWords(text: string): Array<{ raw: string; start: number; end: number }> {
  const words: Array<{ raw: string; start: number; end: number }> = [];
  const pattern = /\S+/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text)) !== null) {
    words.push({ raw: found[0], start: found.index, end: found.index + found[0].length });
  }
  return words;
}

function normWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function overlapLength(committed: string, candidate: string): number {
  const head = splitWords(committed).map((word) => normWord(word.raw));
  const tail = splitWords(candidate);
  const maxWords = Math.min(head.length, tail.length);
  for (let words = maxWords; words >= 1; words--) {
    let match = true;
    for (let i = 0; i < words; i++) {
      const expected = head[head.length - words + i];
      const actual = normWord(tail[i].raw);
      if (expected.length === 0 || expected !== actual) {
        match = false;
        break;
      }
    }
    if (match) {
      // Skip the whole separator run so the merge re-adds exactly one space.
      let end = tail[words - 1].end;
      while (end < candidate.length && /\s/.test(candidate[end])) end += 1;
      return end;
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
