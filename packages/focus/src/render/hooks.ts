/**
 * Host-supplied render hooks (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §4 (M0 constraint #2): markdown is rendered by INJECTION — the host
 * supplies the markdown→HTML conversion (e.g. `marked`). The focus package carries NO `marked`
 * dependency and NO mdast/rehype core. HTML is sanitized via a host-supplied hook; the renderer
 * core owns structure only, hosts own sanitization/styling.
 */

/** Convert markdown source to an HTML string. Host-supplied (e.g. `marked`). */
export type RenderMarkdown = (markdown: string) => string;

/** Sanitize an HTML string before emission. Host-supplied (e.g. DOMPurify / sanitize-html). */
export type SanitizeHtml = (html: string) => string;

/** Hooks the HTML renderer needs from the host. */
export interface HtmlRenderHooks {
  readonly renderMarkdown: RenderMarkdown;
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
