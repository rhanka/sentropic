/**
 * Host render hooks (Focus-M1; markdown default per SPEC_EVOL_FOCUS_DS_PRESENTATION §2 D4).
 *
 * Markdown: focus ships a WORKING built-in default (`marked`, see ./markdown.ts) so the HTML surface
 * renders headings/bold/lists/code without any host wiring. `renderMarkdown` is an OPTIONAL host
 * OVERRIDE (e.g. to unify with a host's marked config). HTML is sanitized via the mandatory host
 * `sanitizeHtml` hook; the renderer core owns structure only, hosts own sanitization/styling.
 */

/** Convert markdown source to an HTML string. Optional host OVERRIDE of the built-in default. */
export type RenderMarkdown = (markdown: string) => string;

/** Sanitize an HTML string before emission. Host-supplied (e.g. DOMPurify / sanitize-html). */
export type SanitizeHtml = (html: string) => string;

/** Hooks the HTML renderer needs from the host. */
export interface HtmlRenderHooks {
  /**
   * OPTIONAL override of the built-in markdown renderer (default = `marked`, see ./markdown.ts).
   * Supply only to unify with a host's own markdown config; omit to use the working default.
   */
  readonly renderMarkdown?: RenderMarkdown;
  readonly sanitizeHtml: SanitizeHtml;
}

/** Hooks the MD renderer needs from the host. */
export interface MdRenderHooks {
  /**
   * MD output is markdown; prose nodes already carry markdown verbatim, so a renderMarkdown
   * hook is OPTIONAL for MD (used only if the host wants to normalize/transform the prose).
   * When omitted, prose markdown is emitted as-is.
   */
  readonly renderMarkdown?: RenderMarkdown;
}
