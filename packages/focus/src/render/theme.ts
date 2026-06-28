/**
 * DS theming for the HTML surface (additive, Focus-M1 L1+).
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
 * The Focus component stylesheet, authored against DS tokens (`var(--st-*)`) with safe fallbacks.
 * The DS theme sheet provides the `--st-*` values under `[data-st-theme]`; this maps the `focus-*`
 * structure (header / question / option set + accept/reject/comment / outcome / amendment-trace /
 * diagram / affordances) to those tokens. Fallbacks keep it legible even with no token sheet.
 */
export const FOCUS_COMPONENT_CSS = `
.focus-document {
  box-sizing: border-box;
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--st-spacing-8, 2rem);
  font-family: var(--st-font-sans, system-ui, -apple-system, sans-serif);
  font-size: 1rem;
  line-height: 1.55;
  color: var(--st-semantic-text-primary, #0f172a);
  background: var(--st-semantic-surface-default, #ffffff);
}
.focus-document *,
.focus-document *::before,
.focus-document *::after {
  box-sizing: border-box;
}
.focus-document h1,
.focus-document h3 {
  font-family: var(--st-font-display, var(--st-font-sans, system-ui, sans-serif));
  color: var(--st-semantic-text-primary, #0f172a);
  line-height: 1.2;
}
.focus-document h1 {
  margin: 0 0 var(--st-spacing-2, 0.5rem);
  font-size: 1.75rem;
}
.focus-document h3 {
  margin: 0 0 var(--st-spacing-3, 0.75rem);
  font-size: 1.15rem;
}
.focus-document code,
.focus-document pre {
  font-family: var(--st-font-mono, ui-monospace, SFMono-Regular, monospace);
}
.focus-document code {
  padding: 0.05em 0.35em;
  border-radius: var(--st-radius-sm, 0.25rem);
  background: var(--st-semantic-surface-subtle, #f8fafc);
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.9em;
}
.focus-header {
  margin-bottom: var(--st-spacing-6, 1.5rem);
  padding-bottom: var(--st-spacing-4, 1rem);
  border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-meta {
  margin: 0;
  color: var(--st-semantic-text-muted, #64748b);
  font-size: 0.85rem;
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
}
.focus-preco {
  margin: 0 0 var(--st-spacing-1, 0.25rem);
  color: var(--st-semantic-text-secondary, #475569);
}
.focus-answer {
  margin: 0;
  color: var(--st-semantic-action-primary, #2563eb);
  font-weight: 600;
}
.focus-optionset ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.focus-option {
  margin: var(--st-spacing-2, 0.5rem) 0;
  padding: var(--st-spacing-3, 0.75rem) var(--st-spacing-4, 1rem);
  border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  border-left-width: 3px;
  border-radius: var(--st-radius-md, 0.375rem);
  background: var(--st-semantic-surface-subtle, #f8fafc);
}
.focus-option[data-annotation="accept"] {
  border-left-color: var(--st-semantic-feedback-success, #16a34a);
}
.focus-option[data-annotation="reject"] {
  border-left-color: var(--st-semantic-feedback-error, #dc2626);
}
.focus-option[data-annotation="comment"] {
  border-left-color: var(--st-semantic-feedback-warning, #d97706);
}
.focus-option-comment {
  color: var(--st-semantic-text-muted, #64748b);
}
.focus-option-body {
  margin-top: var(--st-spacing-1, 0.25rem);
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.9rem;
}
.focus-outcome {
  padding: var(--st-spacing-4, 1rem) var(--st-spacing-6, 1.5rem);
  border: 1px solid var(--st-semantic-border-interactive, #2563eb);
  border-radius: var(--st-radius-lg, 0.5rem);
  background: var(--st-semantic-surface-raised, #ffffff);
  box-shadow: var(--st-shadow-subtle, 0 1px 2px rgb(15 23 42 / 0.08));
}
.focus-amendment-trace {
  padding-top: var(--st-spacing-4, 1rem);
  border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.9rem;
}
.focus-diagram {
  margin: var(--st-spacing-6, 1.5rem) 0;
}
.focus-diagram figcaption {
  margin-bottom: var(--st-spacing-2, 0.5rem);
  color: var(--st-semantic-text-muted, #64748b);
  font-size: 0.85rem;
}
.focus-diagram pre {
  margin: 0;
  padding: var(--st-spacing-4, 1rem);
  overflow: auto;
  border-radius: var(--st-radius-md, 0.375rem);
  background: var(--st-semantic-surface-subtle, #f8fafc);
  color: var(--st-semantic-text-secondary, #475569);
  font-size: 0.85rem;
}
.focus-affordances {
  padding-top: var(--st-spacing-4, 1rem);
  border-top: 1px dashed var(--st-semantic-border-subtle, #e2e8f0);
}
.focus-affordance {
  color: var(--st-semantic-text-muted, #64748b);
}
.focus-affordance-meta {
  font-family: var(--st-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
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
  opts: { readonly title: string; readonly theme: FocusHtmlTheme },
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
    `<html lang="en" data-st-theme="${escapeHtmlAttr(themeId)}">` +
    `<head>${head.join("")}</head>` +
    `<body>${bodyHtml}</body>` +
    "</html>"
  );
};
