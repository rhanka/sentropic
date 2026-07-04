/**
 * DS theming for the HTML surface (additive, Focus-M1).
 *
 * The renderer core stays PURE: by default `renderHtml` emits the bare semantic `focus-*`
 * fragment with NO styling (host owns CSS). This module is the OPT-IN path that wraps that
 * fragment into a SELF-CONTAINED themed document built on the Sentropic Design System
 * static-stylesheet contract:
 *
 *   - the document is scoped with `<html data-st-theme="<themeId>">` so the DS token sheet
 *     (`@sentropic/design-system-themes/css/<themeId>.css` — pure `[data-st-theme]{ --st-* }`
 *     custom properties, ZERO Svelte) cascades to every node;
 *   - the DS tokens are supplied by the host as either a linked sheet (`stylesheetHref`) or an
 *     inlined `<style>` (`inlineCss`, for a fully self-contained file);
 *   - on top, this module ships a SMALL Focus component stylesheet ({@link FOCUS_COMPONENT_CSS})
 *     that maps each `focus-*` class to DS tokens (`var(--st-*)`), since the DS themes carry
 *     TOKENS only, not `focus-*` component rules.
 *
 * Nothing here is a hard dependency of the render core: the option is undefined by default and
 * the default output is unchanged (reversible).
 */

/** Minimal HTML escaping for the renderer-emitted head attributes/text (title/href/themeId). */
const escapeHtmlAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The default DS theme id — matches `@sentropic/design-system-themes/css/entropic.css`. */
export const DEFAULT_FOCUS_THEME_ID = "entropic";

/**
 * Opt-in DS theming for {@link renderHtml}. When supplied, the bare `focus-*` fragment is wrapped
 * in a self-contained themed HTML document. When omitted, the renderer output is unchanged.
 */
export interface FocusHtmlTheme {
  /** DS theme id set on `<html data-st-theme="...">`. Default {@link DEFAULT_FOCUS_THEME_ID}. */
  readonly themeId?: string;
  /** Emit a `<link rel="stylesheet" href="...">` for the DS token sheet (external reference). */
  readonly stylesheetHref?: string;
  /** Inline the DS token CSS in a `<style>` for a fully self-contained document. */
  readonly inlineCss?: string;
  /** Include the Focus component stylesheet ({@link FOCUS_COMPONENT_CSS}). Default `true`. */
  readonly includeComponentCss?: boolean;
}

/**
 * The Focus component stylesheet — FLAT, 100% DS-token-driven (Focus-M1 F4,
 * SPEC_EVOL_FOCUS_DS_PRESENTATION §2 D2/D3, §3).
 *
 * The DS theme sheet provides `--st-*` values under `[data-st-theme]`; this maps the `focus-*`
 * structure to those tokens. NO invented boxes: every content block is FLAT — accents by a left
 * filet (`0.25rem`, the DS Alert `accentWidth` technique) + weight + color + 1px dividers; the ONLY
 * `border-radius` is the pill on badges/tags (`--st-radius-pill`, DS-sanctioned). No `box-shadow`,
 * no encasing border, no radius on content. Mirrors the real (flat) DS components (`Alert.svelte`
 * hard-codes `border-radius: 0`), NOT the stray `--st-component-alert-radius: 0.5rem` token. Prose
 * (rendered markdown) is DS-typographed here as the INTERIM recipe; the durable home is the DS static
 * presentation kit (DS-ASK P1). Fallbacks are byte-equal to entropic values.
 */
export const FOCUS_COMPONENT_CSS = `
.focus-document {
  box-sizing: border-box;
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--st-spacing-8, 2rem);
  font-family: var(--st-font-sans, system-ui, -apple-system, sans-serif);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--st-semantic-text-primary, #0f172a);
  background: var(--st-semantic-surface-default, #ffffff);
  overflow-wrap: anywhere;
}
.focus-document *,
.focus-document *::before,
.focus-document *::after {
  box-sizing: border-box;
}
.focus-document h1,
.focus-document h2,
.focus-document h3,
.focus-document h4 {
  font-family: var(--st-font-display, var(--st-font-sans, system-ui, sans-serif));
  color: var(--st-semantic-text-primary, #0f172a);
  line-height: 1.2;
  text-wrap: balance;
}
.focus-document h1 {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  font-size: 1.9rem;
  font-weight: 750;
  letter-spacing: -0.01em;
}
.focus-document h2 {
  margin: var(--st-spacing-6, 1.5rem) 0 var(--st-spacing-2, 0.5rem);
  font-size: 1.35rem;
  font-weight: 700;
}
.focus-document h3 {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  font-size: 1.1rem;
  font-weight: 680;
}
.focus-document h4 {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  font-size: 1rem;
  font-weight: 650;
}
.focus-document p {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
}
.focus-document a {
  color: var(--st-semantic-text-link, #2563eb);
  text-underline-offset: 2px;
}
.focus-document code {
  font-family: var(--st-font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.9em;
  background: var(--st-semantic-surface-subtle, #f8fafc);
  color: var(--st-semantic-text-secondary, #475569);
  padding: 0.05em 0.35em;
}
.focus-document pre {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  padding: var(--st-spacing-4, 1rem);
  overflow-x: auto;
  background: var(--st-semantic-surface-subtle, #f8fafc);
  border-left: 0.2rem solid var(--st-semantic-border-subtle, #e2e8f0);
  font-family: var(--st-font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.85rem;
  line-height: 1.5;
}
.focus-document pre code {
  background: transparent;
  padding: 0;
}
.focus-document ul,
.focus-document ol {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  padding-left: 1.35rem;
}
.focus-document li {
  margin: 0.2rem 0;
}
.focus-document blockquote {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  padding-left: var(--st-spacing-4, 1rem);
  border-left: 0.2rem solid var(--st-semantic-border-subtle, #e2e8f0);
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-document table {
  width: 100%;
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  border-collapse: collapse;
  font-size: 0.92rem;
}
.focus-document th,
.focus-document td {
  padding: 0.4rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-document th {
  font-weight: 650;
}
.focus-eyebrow {
  display: block;
  margin-bottom: var(--st-spacing-1, 0.25rem);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--st-semantic-text-muted, #64748b);
}
.focus-header {
  margin-bottom: var(--st-spacing-6, 1.5rem);
  padding-bottom: var(--st-spacing-4, 1rem);
  border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-header h1 {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
}
.focus-meta {
  margin: 0;
  color: var(--st-semantic-text-muted, #64748b);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.focus-prose,
.focus-question,
.focus-optionset,
.focus-outcome,
.focus-amendment-trace,
.focus-diagram,
.focus-affordances {
  margin: var(--st-spacing-6, 1.5rem) 0;
}
.focus-q {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  font-size: 1.05rem;
}
.focus-q em {
  color: var(--st-semantic-text-muted, #64748b);
  font-style: normal;
  font-weight: 600;
}
.focus-q-context {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-preco {
  margin: 0 0 var(--st-spacing-1, 0.25rem);
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-answer {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  color: var(--st-semantic-action-primary, #2563eb);
  font-weight: 600;
}
.focus-q-stakes {
  margin: var(--st-spacing-2, 0.5rem) 0 0;
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-optionset ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.focus-option {
  margin: 0;
  padding: var(--st-spacing-4, 1rem) 0 var(--st-spacing-4, 1rem) var(--st-spacing-4, 1rem);
  border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  border-left: 0.25rem solid var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-option:first-child {
  border-top: 0;
}
.focus-option[data-annotation="accept"] {
  border-left-color: var(--st-component-alert-successBorder, #16a34a);
}
.focus-option[data-annotation="reject"] {
  border-left-color: var(--st-component-alert-errorBorder, #dc2626);
}
.focus-option[data-annotation="comment"] {
  border-left-color: var(--st-component-alert-warningBorder, #d97706);
}
.focus-option[data-recommended="true"] {
  background: var(--st-semantic-surface-subtle, #f8fafc);
}
.focus-option-head {
  margin: 0 0 var(--st-spacing-1, 0.25rem);
  font-size: 1.02rem;
}
.focus-option-comment {
  color: var(--st-semantic-text-muted, #64748b);
  font-weight: 400;
}
.focus-option-summary {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-option-body,
.focus-option-rationale,
.focus-option-consequence,
.focus-option-impact {
  margin: var(--st-spacing-2, 0.5rem) 0 0;
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.94rem;
}
.focus-badge {
  display: inline-block;
  padding: 0.08em 0.6em;
  border-radius: var(--st-radius-pill, 999px);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  vertical-align: middle;
}
.focus-badge-recommended {
  background: color-mix(in srgb, var(--st-semantic-feedback-success, #16a34a) 14%, white);
  color: var(--st-semantic-feedback-success, #16a34a);
}
.focus-outcome {
  padding: var(--st-spacing-4, 1rem) var(--st-spacing-4, 1rem) var(--st-spacing-4, 1rem) var(--st-spacing-6, 1.5rem);
  border-left: 0.25rem solid var(--st-semantic-feedback-success, #16a34a);
  background: color-mix(in srgb, var(--st-semantic-feedback-success, #16a34a) 6%, var(--st-semantic-surface-default, #ffffff));
}
.focus-outcome h3 {
  margin: 0 0 var(--st-spacing-1, 0.25rem);
}
.focus-verdict {
  margin: 0 0 var(--st-spacing-1, 0.25rem);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--st-semantic-feedback-success, #16a34a);
}
.focus-outcome-statement {
  margin: 0;
  color: var(--st-semantic-text-primary, #0f172a);
}
.focus-outcome-motivation {
  margin: var(--st-spacing-3, 0.75rem) 0 0;
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-amendment-trace {
  padding-top: var(--st-spacing-4, 1rem);
  border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.9rem;
}
.focus-amendment-trace ol {
  margin: 0;
  padding-left: 1.2rem;
}
.focus-amendment-trace code {
  font-size: 0.8rem;
}
.focus-diagram figcaption {
  margin-bottom: var(--st-spacing-2, 0.5rem);
  color: var(--st-semantic-text-muted, #64748b);
  font-size: 0.85rem;
}
.focus-diagram pre {
  margin: 0;
}
.focus-affordances {
  padding-top: var(--st-spacing-4, 1rem);
  border-top: 1px dashed var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-affordances ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.focus-affordance {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: var(--st-spacing-2, 0.5rem) 0;
}
.focus-affordance-btn {
  display: inline-block;
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  border-radius: var(--st-radius-pill, 999px);
  background: var(--st-semantic-action-secondary, #f8fafc);
  color: var(--st-semantic-text-muted, #64748b);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: not-allowed;
}
.focus-affordance-cmd {
  padding: 0.15rem 0.45rem;
  background: var(--st-semantic-surface-subtle, #f8fafc);
  color: var(--st-semantic-text-secondary, #475569);
  font-family: var(--st-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}
`;

/**
 * Wrap a sanitized `focus-*` body fragment into a self-contained themed HTML document.
 *
 * Security posture: the host {@link FocusHtmlTheme} `inlineCss`/`stylesheetHref` and the
 * {@link FOCUS_COMPONENT_CSS} are renderer-trusted (not user content), so they are emitted raw in
 * the `<head>`; the untrusted document body was already run through the host `sanitizeHtml` hook
 * BEFORE wrapping (a content sanitizer would otherwise strip `<head>`/`<style>`/`<link>`).
 */
export const wrapThemedHtmlDocument = (
  bodyHtml: string,
  opts: {
    readonly title: string;
    /** BCP-47 `<html lang>` value (from the document's authored language). Default `"en"`. */
    readonly lang?: string;
    readonly theme: FocusHtmlTheme;
  },
): string => {
  const themeId = opts.theme.themeId ?? DEFAULT_FOCUS_THEME_ID;
  const includeComponentCss = opts.theme.includeComponentCss ?? true;

  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtmlAttr(opts.title)}</title>`,
  ];
  if (opts.theme.stylesheetHref !== undefined) {
    head.push(
      `<link rel="stylesheet" href="${escapeHtmlAttr(opts.theme.stylesheetHref)}">`,
    );
  }
  if (opts.theme.inlineCss !== undefined) {
    head.push(`<style data-focus-theme-tokens>${opts.theme.inlineCss}</style>`);
  }
  if (includeComponentCss) {
    head.push(`<style data-focus-component-css>${FOCUS_COMPONENT_CSS}</style>`);
  }

  return (
    "<!DOCTYPE html>" +
    `<html lang="${escapeHtmlAttr(opts.lang ?? "en")}" data-st-theme="${escapeHtmlAttr(themeId)}">` +
    `<head>${head.join("")}</head>` +
    `<body>${bodyHtml}</body>` +
    "</html>"
  );
};
