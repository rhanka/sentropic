/**
 * Default markdown → HTML renderer for the HTML surface
 * (Focus-M1 F1, SPEC_EVOL_FOCUS_DS_PRESENTATION §2 D4).
 *
 * WHY: the previous design delegated `prose` markdown to a host-supplied `renderMarkdown` hook that
 * nobody wired — so `## `, `**bold**`, lists and code rendered RAW. Focus now ships a WORKING default
 * so `stp focus --format html` renders real markdown with zero host wiring. The host hook stays an
 * OVERRIDE (e.g. to unify with a host's marked config). `marked` is the same engine chat-ui hosts
 * inject (`ui`/`api` already depend on it) — cross-surface parity, no mdast/rehype core.
 *
 * SECURITY: this module does NOT sanitize. The caller (`renderHtml`) runs the fully composed document
 * through the mandatory host `sanitizeHtml` hook before emission.
 */
import { marked } from "marked";

/**
 * Render a markdown source string to an HTML fragment string (synchronous).
 * Options are passed inline (no global `marked.setOptions`) to keep this module side-effect-free
 * (`"sideEffects": false`): GFM on (tables/strikethrough/autolinks), `breaks` off (a single newline
 * is not a `<br>` in prose).
 */
export const defaultRenderMarkdown = (markdown: string): string =>
  marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
