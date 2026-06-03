/**
 * markdown-refs.ts — portable citation/ref markdown rendering utilities.
 *
 * Extracted from ui/src/lib/utils/markdown.ts (renderMarkdownWithRefs + helpers).
 * No browser APIs, no Svelte imports, no $lib coupling, no markdown-lib dep —
 * safe for node-only vitest and any runtime.
 *
 * App-specific concerns are injected as callbacks:
 *   - `markdownToHtml` — caller supplies the markdown renderer (e.g. `marked`)
 *   - `renderRef`      — caller supplies the ref-link HTML builder
 *   - HTML sanitization (DOMPurify) stays in the host app; lib returns raw HTML
 *
 * This keeps the lib framework-agnostic and dependency-free for its core logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A citation / reference entry (title + URL). */
export interface Reference {
  title: string;
  url: string;
}

/** Options for markdown post-processing (CSS class injection). */
export interface RenderMarkdownOptions {
  /**
   * If true, inject Tailwind list classes onto `<ul>`, `<ol>`, `<li>`.
   * @default false
   */
  addListStyles?: boolean;
  /**
   * If true, inject Tailwind heading classes onto `<h2>`, `<h3>`.
   * @default false
   */
  addHeadingStyles?: boolean;
  /**
   * Left-padding for lists in rem (used when addListStyles is true).
   * @default 1.5
   */
  listPadding?: number;
}

/**
 * Callback that converts a markdown string to an HTML string.
 * Callers inject their preferred markdown library (e.g. `marked`, `marked.parse`,
 * or any other markdown-to-HTML function with the same signature).
 *
 * @param markdown - Normalised markdown source
 * @returns        HTML string
 */
export type MarkdownToHtmlFn = (markdown: string) => string;

/**
 * Callback that turns a numeric citation token and its Reference entry into
 * an HTML fragment string.  Inject your app-specific link renderer here.
 *
 * The default (`createDefaultRefLink`) produces a `#ref-N` anchor with a
 * smooth-scroll onclick — identical to the app implementation.
 *
 * @param num  - 1-based citation number as a string (e.g. `"1"`, `"2"`)
 * @param ref  - The Reference entry at that index
 * @returns    An HTML fragment string (must NOT contain unescaped user content)
 */
export type RefLinkRenderer = (num: string, ref: Reference) => string;

// ---------------------------------------------------------------------------
// Markdown normalisation helpers
// ---------------------------------------------------------------------------

const BULLET_PATTERN = /(^|\n)[ \t]*[•▪‣●◦]/g;
const SINGLE_NEWLINE_PATTERN = /([^\n\r])\r?\n(?!\r?\n|\s*[-*•]|\s*$)/g;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]|(?:\d+\.)|•|‣|◦)\s+/;

/**
 * Normalise line-endings to `\n` only.
 * Handles null / undefined / non-string input gracefully.
 */
export function normalizeMarkdownLineEndings(text: unknown): string {
  if (text === null || text === undefined) return '';
  const value = typeof text === 'string' ? text : String(text);
  return value.replace(/\r\n?/g, '\n');
}

/**
 * Normalise a markdown field from legacy use-case data:
 * - Convert unicode bullets to markdown `-`
 * - Add blank lines between paragraphs
 * - Idempotent
 */
export function normalizeUseCaseMarkdown(text: unknown): string {
  if (text === null || text === undefined) return '';

  if (Array.isArray(text)) {
    const items = (text as unknown[])
      .map((v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && 'key' in (v as Record<string, unknown>))
          return String((v as Record<string, unknown>)['key'] ?? '');
        try {
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      })
      .map((s) => s.trim())
      .filter(Boolean);
    return items.map((item) => `- ${item}`).join('\n');
  }

  if (typeof text !== 'string') {
    text = String(text);
  }
  const input = (text as string).trim();
  if (!input) return '';

  let normalized = normalizeMarkdownLineEndings(input);
  normalized = normalized.replace(BULLET_PATTERN, '$1- ');
  normalized = normalized.replace(SINGLE_NEWLINE_PATTERN, '$1\n\n');
  return normalized.trim();
}

/**
 * Strip a trailing empty paragraph that can appear after a list.
 * Idempotent.
 */
export function stripTrailingEmptyParagraph(text: string | null | undefined): string {
  if (!text) return '';

  const normalized = normalizeMarkdownLineEndings(text);
  const lines = normalized.split('\n');

  let removed = false;
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) {
    lines.pop();
    removed = true;
  }

  if (!removed) return text;
  if (lines.length === 0) return '';

  const lastLine = lines[lines.length - 1]!.trim();
  if (!BULLET_LINE_PATTERN.test(lastLine)) return text;

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Default ref-link renderer (mirrors app implementation)
// ---------------------------------------------------------------------------

/**
 * Build a `<a href="#ref-N">` anchor with a smooth-scroll onclick handler.
 * This is the same HTML produced by the app's `createReferenceLink`.
 *
 * Consumers that need different link behaviour (e.g. open URL in new tab,
 * custom styling) should pass their own `RefLinkRenderer` to
 * `renderMarkdownWithRefs`.
 */
export function createDefaultRefLink(num: string, _ref: Reference): string {
  const refId = `ref-${num}`;
  return `<a href="#${refId}" class="text-blue-600 hover:text-blue-800 cursor-pointer" style="text-decoration:none" onclick="event.preventDefault(); document.getElementById('${refId}')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return false;">[${num}]</a>`;
}

// ---------------------------------------------------------------------------
// Core rendering
// ---------------------------------------------------------------------------

/**
 * Render markdown as HTML, substituting `[N]` citation tokens with ref links.
 *
 * **No HTML sanitization is performed here** — this is intentional so the
 * lib stays browser-agnostic (DOMPurify requires `window`).  Callers are
 * responsible for sanitizing the returned HTML before inserting it into the
 * DOM (e.g. via DOMPurify in the host app, or a server-side sanitizer).
 *
 * @param text         - Markdown source (null/undefined → `""`)
 * @param references   - Ordered reference list; `[1]` maps to index 0, etc.
 * @param options      - Optional CSS class injection for lists / headings
 * @param renderRef    - Callback that turns (num, ref) → HTML fragment.
 *                       Defaults to `createDefaultRefLink`.
 * @param markdownToHtml - Callback that converts markdown → HTML.
 *                         Pass `(src) => String(marked(src))` or equivalent.
 *                         Defaults to a minimal fallback that wraps the text
 *                         in a `<p>` tag (so the lib has zero runtime deps).
 *                         For accurate rendering, always inject a real markdown
 *                         library (e.g. `import { marked } from 'marked'`).
 * @returns Rendered HTML string (unsanitized — sanitize before DOM insertion)
 */
export function renderMarkdownWithRefs(
  text: string | null | undefined,
  references: Reference[] = [],
  options: RenderMarkdownOptions = {},
  renderRef: RefLinkRenderer = createDefaultRefLink,
  markdownToHtml: MarkdownToHtmlFn = (src) => `<p>${src}</p>`,
): string {
  if (!text) return '';

  // Normalise markdown (unicode bullets, line endings, etc.)
  let normalized = normalizeUseCaseMarkdown(text);

  // Collapse pre-baked markdown reference links back to plain [N] tokens so
  // the placeholder logic below handles them uniformly.
  //   [\[N\]](#ref-N "title")  or  [[N]](#ref-N "title")
  normalized = normalized.replace(
    /\[\\?\[(\d+)\\?\]\]\(#ref-\d+(?:\s+"[^"]*")?\)/g,
    (_match, num) => `[${num}]`,
  );

  // Replace [N] tokens with opaque placeholders BEFORE the markdown renderer
  // so that it does not interpret them as markdown link references.
  const placeholderMap = new Map<string, string>();
  if (references.length > 0) {
    normalized = normalized.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num) - 1;
      if (index >= 0 && index < references.length) {
        const placeholder = `XREFX${num}XREFX`;
        placeholderMap.set(placeholder, renderRef(num, references[index]!));
        return placeholder;
      }
      return match;
    });
  }

  // Convert markdown → HTML via injected renderer
  let html = markdownToHtml(normalized);

  // Optional CSS class injection
  const { addListStyles = false, addHeadingStyles = false, listPadding = 1.5 } = options;

  if (addListStyles) {
    html = html.replace(/<ul>/g, `<ul class="list-disc space-y-2 mb-4" style="padding-left:${listPadding}rem;">`);
    html = html.replace(/<ol>/g, `<ol class="list-decimal space-y-2 mb-4" style="padding-left:${listPadding}rem;">`);
    html = html.replace(/<li>/g, '<li class="mb-1">');
  }

  if (addHeadingStyles) {
    html = html.replace(/<h2>/g, '<h2 class="text-xl font-semibold text-slate-900 mt-6 mb-4">');
    html = html.replace(/<h3>/g, '<h3 class="text-lg font-semibold text-slate-800 mt-4 mb-3">');
  }

  // Restore placeholders with actual ref-link HTML AFTER markdown rendering
  for (const [placeholder, link] of placeholderMap) {
    html = html.split(placeholder).join(link);
  }

  return html;
}
