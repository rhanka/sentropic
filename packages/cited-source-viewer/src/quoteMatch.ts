/**
 * Verbatim quote matching against a source text (a pdf.js page text layer or a
 * markdown/plain-text document).
 *
 * PURE logic — no pdf.js, no DOM, no graphify import. TypeScript port of the
 * qualified graphify interim `studio/src/lib/cited-source/quoteMatch.js`
 * (itself ported from radar-immobilier `pdf-citation-match.ts`, the
 * architect-ratified SignalPdfOverlay seed). Logic is intentionally unchanged
 * (SPEC_WP_CITED_SOURCE_VIZ §S.2: "one matcher, two callers"). Strategy:
 *   1. Normalize the quote and the source text the same way, keeping for the
 *      source a normalized-index -> raw-index map.
 *   2. Look for the normalized quote as a substring; when absent, fall back to
 *      the longest window of consecutive quote words present in the source
 *      (robust to OCR/pdftotext truncation and noisy heads/tails).
 *   3. Return the [start, end) interval in the RAW source text, which callers
 *      convert into highlight spans / <mark> ranges.
 */

export interface CitationMatch {
  /** Start index in the raw source text. */
  start: number;
  /** End index (exclusive) in the raw source text. */
  end: number;
  /** Fraction of the quote (in words) actually found, in [0, 1]. */
  coverage: number;
}

export interface CitationMatchOptions {
  minWords?: number;
  minCoverage?: number;
}

/** Minimal shape of a pdf.js `getTextContent()` item (text-bearing ones carry `str`). */
export interface PdfTextItemLike {
  str?: unknown;
  transform?: number[];
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/**
 * Normalize a text for matching: lowercase, accents stripped, ligatures
 * decomposed, whitespace (and soft hyphen runs) collapsed to single spaces.
 * Punctuation is kept but surrounding whitespace is normalized.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKD") // decompose accents + ligatures (œ -> oe via replacements below)
    .replace(/œ/gu, "oe")
    .replace(/Œ/gu, "OE")
    .replace(/æ/gu, "ae")
    .replace(/Æ/gu, "AE")
    .replace(/[̀-ͯ]/gu, "") // combining diacritics
    .replace(/[‘’‚‛′]/gu, "'") // typographic apostrophes
    .replace(/[“”„‟″]/gu, '"') // quotes
    .replace(/[‐-―]/gu, "-") // unicode dashes -> -
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Build the normalized source text + the normalized-index -> raw-index map
 * (used to recover the original highlight interval).
 */
function buildNormalizedIndex(raw: string): { normalized: string; map: number[] } {
  const normalizedChars: string[] = [];
  const map: number[] = [];
  let prevWasSpace = true; // avoids a leading space
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    // Whitespace is detected on the RAW character: `normalizeForMatch` trims,
    // which would reduce an isolated blank to "".
    if (/\s/u.test(ch)) {
      if (prevWasSpace) continue;
      normalizedChars.push(" ");
      map.push(i);
      prevWasSpace = true;
      continue;
    }
    const norm = normalizeForMatch(ch);
    if (norm.length === 0) {
      // Character that disappears under normalization (lone combining mark,
      // soft hyphen…): absorbed into the previous character.
      continue;
    }
    // A ligature can yield several characters (e.g. œ -> oe): all map to i.
    for (const c of norm) {
      normalizedChars.push(c);
      map.push(i);
    }
    prevWasSpace = false;
  }
  // Strip a possible trailing space.
  while (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === " ") {
    normalizedChars.pop();
    map.pop();
  }
  return { normalized: normalizedChars.join(""), map };
}

/**
 * Find the quote `excerpt` inside the raw `pageText` and return the raw
 * highlightable interval, or `null` when nothing usable matches.
 *
 * - Exact (normalized) match first.
 * - Else, the longest run of consecutive quote words present in the source:
 *   the quote is eroded from the edges until a window of at least `minWords`
 *   words matches. Covers heads/tails clipped by pdftotext/OCR.
 *
 * `minWords` defaults to 6 with a 0.4 minimum coverage (radar bug #83: a short
 * generic window matched on several pages and produced stray highlights; the
 * fallback must be BOTH long enough AND cover a significant share of the quote).
 */
export function findCitationInPage(
  pageText: string,
  excerpt: string,
  options: CitationMatchOptions = {},
): CitationMatch | null {
  const minWords = options.minWords ?? 6;
  const minCoverage = options.minCoverage ?? 0.4;

  const cleanExcerpt = normalizeForMatch(excerpt ?? "");
  if (cleanExcerpt.length === 0) return null;
  const totalWords = cleanExcerpt.split(" ").filter(Boolean);
  if (totalWords.length === 0) return null;

  const { normalized, map } = buildNormalizedIndex(pageText ?? "");
  if (normalized.length === 0) return null;

  const toRawRange = (normStart: number, normEnd: number): CitationMatch | null => {
    if (normStart < 0 || normEnd <= normStart || normEnd > map.length) return null;
    const rawStart = map[normStart] as number;
    const rawEnd = (map[normEnd - 1] ?? rawStart) + 1;
    return { start: rawStart, end: rawEnd, coverage: 0 };
  };

  // 1) Exact normalized match.
  const exactIdx = normalized.indexOf(cleanExcerpt);
  if (exactIdx >= 0) {
    const range = toRawRange(exactIdx, exactIdx + cleanExcerpt.length);
    if (range) return { ...range, coverage: 1 };
  }

  // 2) Longest window of consecutive quote words present in the source.
  //    Try sub-sequences [i, j) of the quote, longest first, via a shrinking
  //    sliding window. Cost bounded by capping the quote length considered.
  const maxWindow = Math.min(totalWords.length, 60);
  for (let windowLen = maxWindow; windowLen >= minWords; windowLen--) {
    for (let i = 0; i + windowLen <= totalWords.length; i++) {
      const candidate = totalWords.slice(i, i + windowLen).join(" ");
      const idx = normalized.indexOf(candidate);
      if (idx >= 0) {
        const range = toRawRange(idx, idx + candidate.length);
        if (range) {
          const coverage = windowLen / totalWords.length;
          // AND (not OR): the window must be long enough AND cover a
          // significant share of the quote (radar bug #83).
          if (coverage >= minCoverage && windowLen >= minWords) {
            return { ...range, coverage };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Concatenate a pdf.js `getTextContent()` item list into one page string,
 * remembering each item's [start, end) offset so a {@link CitationMatch}
 * interval can be mapped back to the items it overlaps. Pure (the caller
 * passes plain objects); pdf.js mixes TextItem (with `str`) and
 * TextMarkedContent (without) — only text-bearing items are kept.
 */
export function buildPageText(items: PdfTextItemLike[]): {
  pageText: string;
  offsets: { start: number; end: number; item: PdfTextItemLike }[];
} {
  let pageText = "";
  const offsets: { start: number; end: number; item: PdfTextItemLike }[] = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (typeof raw?.str !== "string") continue;
    const start = pageText.length;
    pageText += raw.str;
    offsets.push({ start, end: pageText.length, item: raw });
    // Separator between items (pdf.js items carry no trailing space).
    pageText += " ";
  }
  return { pageText, offsets };
}
