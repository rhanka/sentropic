/**
 * Markdown / plain-text source rendering with the cited quote highlighted.
 *
 * PURE (no DOM, no graphify import): given the raw source text and the quote,
 * emit safe HTML — everything escaped, minimal markdown affordances re-enabled
 * (headings + bold/italic), and the matched quote range wrapped in
 * `<mark class="csv-mark">`. The markdown body injects the result via {@html}
 * and scrolls to the mark. Deliberately self-contained (ZERO markdown
 * dependency — within the v1 ratified-deps budget; swapping in `markdown-it`
 * for richer rendering is a v1.x architect decision, not a seam change).
 * TypeScript port of the qualified graphify interim
 * `studio/src/lib/cited-source/markdownSource.js`; logic unchanged.
 */

import { findCitationInPage, type CitationMatchOptions } from "./quoteMatch.js";

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/** Escaped text with **bold** / *italic* runs re-enabled. */
function inlineMd(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
}

/**
 * Render ONE block (paragraph or heading) of already-sliced raw text to HTML.
 */
function renderBlock(block: string): string {
  const heading = /^(#{1,6})\s+(.*)$/.exec(block.trim());
  if (heading) {
    const level = Math.min((heading[1] as string).length + 2, 6); // demote: source h1 -> h3
    return `<h${level} class="csv-md-h">${inlineMd(escapeHtml(heading[2]))}</h${level}>`;
  }
  return `<p class="csv-md-p">${inlineMd(escapeHtml(block)).replace(/\n/g, "<br>")}</p>`;
}

export interface RenderedSourceHtml {
  html: string;
  /** False when the quote could not be located (graceful degradation). */
  found: boolean;
  coverage: number;
}

/**
 * Render the whole source with the quote's matched range wrapped in a <mark>.
 *
 * The match runs over the RAW text (quoteMatch keeps a normalized->raw map), so
 * the mark lands on the verbatim passage even when the quote differs by
 * whitespace/accents/ligatures. When the quote cannot be located the source is
 * rendered WITHOUT a mark and `found` is false (graceful degradation — the
 * viewer says so instead of pretending).
 */
export function renderSourceHtml(
  text: string,
  quote: string | null | undefined,
  matchOptions: CitationMatchOptions = {},
): RenderedSourceHtml {
  const raw = String(text ?? "");
  const match = quote ? findCitationInPage(raw, quote, matchOptions) : null;

  // Split into blocks on blank lines, tracking each block's raw offset so the
  // match interval can be projected into per-block mark ranges.
  const blocks: { start: number; end: number; text: string }[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g; // runs of non-blank lines
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (!match || match.end <= block.start || match.start >= block.end) {
      parts.push(renderBlock(block.text));
      continue;
    }
    // Overlap: split the block into pre / marked / post, escape each side, and
    // rebuild one paragraph (heading blocks with a partial match render as a
    // paragraph too — precision over prettiness for the highlighted region).
    const relStart = Math.max(0, match.start - block.start);
    const relEnd = Math.min(block.text.length, match.end - block.start);
    const pre = escapeHtml(block.text.slice(0, relStart)).replace(/\n/g, "<br>");
    const hit = escapeHtml(block.text.slice(relStart, relEnd)).replace(/\n/g, "<br>");
    const post = escapeHtml(block.text.slice(relEnd)).replace(/\n/g, "<br>");
    parts.push(
      `<p class="csv-md-p">${pre}<mark class="csv-mark" data-csv-mark="1">${hit}</mark>${post}</p>`,
    );
  }

  return {
    html: parts.join("\n"),
    found: Boolean(match),
    coverage: match?.coverage ?? 0,
  };
}
