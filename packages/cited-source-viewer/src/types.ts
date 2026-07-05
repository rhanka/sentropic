/**
 * @sentropic/cited-source-viewer — seam types.
 *
 * LOCAL MIRROR OF THE FROZEN CONTRACT (purity by construction).
 * ------------------------------------------------------------
 * `CitedSourceRef` / `OntologyCitation` below are a verbatim re-declaration of
 * graphify's frozen cited-source seam (SPEC_WP_CITED_SOURCE_VIZ §S.1 + §0.2.1;
 * graphify `src/types.ts` as of 2026-07-04). They are re-declared here ON
 * PURPOSE — the architect's §S.5 condition (b) requires this package to carry
 * ZERO graphify dependency (runtime OR type-time), so the contract is
 * mirrored, not imported. Any divergence from the graphify types is a
 * contract-review event between the two owners, never a silent local edit.
 * The purity test gate (`tests/purity.spec.ts`) enforces the no-import side.
 */

/** Source modality tag — drives the body-renderer routing (§S.4). */
export type CitationModality =
  | "markdown"
  | "pdf"
  | "docx"
  | "pptx"
  | "image"
  | "plain-text"
  | "csv"
  | "web";

/** Grounding strength of a citation (EXTRACTED = verified verbatim match). */
export type CitationConfidence = "EXTRACTED" | "INFERRED";

/**
 * The reference the viewer consumes (one citation occurrence, projected by the
 * consumer via graphify's `citationToCitedSourceRef` or an equivalent mapper).
 * Mirror of graphify `CitedSourceRef` — see the module header.
 */
export interface CitedSourceRef {
  /** Content-addressed document hash (no `sha256:` prefix when exchanged with Radar). */
  docSha?: string;
  /** Object-store/CAS key (e.g. `raw/proces-verbaux-<city>/cas/<sha>.pdf`). */
  rawRef?: string;
  sourceUrl?: string;
  /** Source modality; when absent, consumers derive it from the locator suffix. */
  modality?: CitationModality;
  /** 1-based source page number. Required anchor for page-addressable modalities. */
  page?: number;
  /** Section / heading anchor for non-page modalities. */
  section?: string;
  /** Paragraph / text-frame / CSV-row id anchor for non-page modalities. */
  paragraph_id?: string;
  /** Normalized top-left page fractions [x0,y0,x1,y1] (pdf/image/pptx). */
  bbox?: [number, number, number, number];
  /** Verbatim evidence text used for text-match highlighting. */
  excerpt?: string;
  citation?: string;
  publishedAt?: string;
  meetingDate?: string;
  quoteSpan?: [number, number];
}

/**
 * Mirror of graphify's post-Lot-0 `OntologyCitation` (§S.1) — provided so
 * consumers that hold raw graphify citations can type their own projection to
 * `CitedSourceRef` against this package without importing graphify.
 */
export interface OntologyCitation {
  source_file: string;
  source_url?: string;
  rawRef?: string;
  docSha?: string;
  sourceUrl?: string;
  page?: number | string;
  section?: string;
  paragraph_id?: string;
  figure_id?: string;
  bbox?: [number, number, number, number];
  region?: [number, number, number, number];
  modality?: CitationModality;
  excerpt?: string;
  quoteSpan?: [number, number];
  source_location?: string;
  quote?: string;
  /**
   * Grounding strength. Mirrors graphify HEAD exactly (string enum only).
   * NOTE: SPEC_WP_CITED_SOURCE_VIZ §S.1 still shows `| number` (0..1) — the
   * implemented graphify contract narrowed it to the enum; flagged to the
   * architect in the Lot-2 attestation (2026-07-05, graphify @ 29689f05).
   */
  confidence?: CitationConfidence;
}

/* ── Source resolution seam (§S.3 — the viewer never reads bytes itself) ── */

/**
 * The minimal shape the FRAME routes on. Custom (v2/v3) payload types extend
 * this base; the frame only ever reads `kind` and hands the payload to the
 * registered body untouched.
 */
export interface SourcePayloadBase {
  kind: string;
}

/** PDF payload: raw bytes; rendered by the pdf.js text-layer body. */
export interface PdfSourcePayload extends SourcePayloadBase {
  kind: "pdf";
  data: ArrayBuffer | Uint8Array;
}

/** Markdown / plain-text payload: raw text; rendered by the markdown body. */
export interface TextSourcePayload extends SourcePayloadBase {
  kind: "markdown" | "text";
  text: string;
}

/**
 * The CLOSED v1 payload union — a real discriminated union, so body/consumer
 * code narrows on `payload.kind` (architect API review, touch 1: no generic
 * catch-all member collapsing the discriminant). Future bodies do NOT widen
 * this union: a v2/v3 payload type extends {@link SourcePayloadBase} and is
 * declared BY ITS BODY (see `CitedSourceBodyProps<P>` and the registry docs).
 */
export type SourcePayload = PdfSourcePayload | TextSourcePayload;

/**
 * Consumer-supplied byte/text resolver (§S.3). Defaults to the v1 union; a
 * consumer feeding custom bodies widens the parameter explicitly, e.g.
 * `ResolveSource<SourcePayload | DocxPayload>`.
 */
export type ResolveSource<P extends SourcePayloadBase = SourcePayload> = (
  ref: CitedSourceRef,
) => Promise<P>;

/** Consumer-supplied raw-source href ("Ouvrir ↗"); null/undefined hides the button. */
export type SourceHref = (ref: CitedSourceRef) => string | null | undefined;

/* ── Grouped thread + scope (§S.6 extended API) ─────────────────────────── */

/**
 * One group of refs in the citation thread — typically ONE ENTITY's citations
 * when the host opens the viewer over a multi-entity selection.
 */
export interface CitedSourceGroup {
  /** Stable host-side id (e.g. the entity/node id). */
  id: string;
  /** Human label for the group (e.g. the entity name). */
  label?: string;
  refs: CitedSourceRef[];
}

/**
 * Navigation scope of the ‹ Citation x/y › thread:
 * - `"entity"`   — the citation navigator runs within the ACTIVE group only;
 * - `"selection"`— it runs over the whole flattened thread (all groups).
 * Only meaningful when `groups` is provided with 2+ groups (the toggle and the
 * ‹ Entité x/y › navigator are hidden otherwise).
 */
export type CitedSourceScope = "entity" | "selection";

/** Focus snapshot emitted through `onFocusChange` on every retarget. */
export interface CitedSourceFocus {
  /** Global index of the active ref in the flattened thread. */
  index: number;
  ref: CitedSourceRef;
  scope: CitedSourceScope;
  /** Active group id, or null when the thread is ungrouped. */
  groupId: string | null;
  /** Active group position (0-based), -1 when ungrouped. */
  groupIndex: number;
  /** Active ref position within its group (0-based), -1 when ungrouped. */
  groupRefIndex: number;
  /** The active ref's document locator (rawRef ?? sourceUrl ?? docSha ?? ""). */
  docLocator: string;
  /** Document position within the CURRENT scope's thread (0-based). */
  docIndex: number;
  docCount: number;
}

/** All user-facing strings; defaults carry the principal-qualified UX labels. */
export interface CitedSourceViewerLabels {
  kicker: string;
  citation: string;
  doc: string;
  page: string;
  entity: string;
  selection: string;
  open: string;
  close: string;
  scopeToggle: string;
  loading: string;
  noSelection: string;
  unavailableTitle: string;
  zoomReset: string;
  notLocatedOnPage: string;
  notLocatedInDoc: string;
  previousCitation: string;
  nextCitation: string;
  previousDocument: string;
  nextDocument: string;
  previousEntity: string;
  nextEntity: string;
  previousPage: string;
  nextPage: string;
  zoomOut: string;
  zoomIn: string;
}

/** Props of the `CitedSourceViewer` frame component. */
export interface CitedSourceViewerProps {
  /** Flat citation thread (v1 seam — kept for ungrouped consumers). */
  refs?: CitedSourceRef[];
  /** Grouped thread (one group per entity). When set, it supersedes `refs`. */
  groups?: CitedSourceGroup[] | null;
  /** Initial navigation scope (see {@link CitedSourceScope}). */
  scope?: CitedSourceScope;
  /** Initial active ref, as a GLOBAL index into the flattened thread. */
  activeIndex?: number;
  /** Header title (e.g. the source file or the entity the user clicked). */
  title?: string;
  /**
   * §S.3 resolver. Typed against the BASE so resolvers feeding custom bodies
   * (v2/v3 kinds) assign without a cast; a plain v1 `ResolveSource` also fits.
   */
  resolveSource: ResolveSource<SourcePayloadBase>;
  sourceHref?: SourceHref | null;
  /** Extra class(es) appended to the frame's root `<section class="csv">`. */
  class?: string;
  /** Close callback; the ✕ button is hidden when absent (non-modal host owns it). */
  onClose?: (() => void) | null;
  /** Fired on mount and on every focus retarget (nav, scope toggle, reopen). */
  onFocusChange?: ((focus: CitedSourceFocus) => void) | null;
  /** Label overrides (i18n); merged over the qualified defaults. */
  labels?: Partial<CitedSourceViewerLabels>;
}

/* ── Body-renderer seam (one UX, many bodies — §S.4/§S.6) ───────────────── */

/**
 * State a body reports up to the frame. The frame renders the generic toolbar
 * from this alone — a body never renders toolbar chrome itself.
 */
export interface CitedSourceBodyStatus {
  /** True for page-addressable bodies (pdf/pptx/image): shows Page + zoom segments. */
  pageAddressable: boolean;
  /** Current 1-based page (page-addressable bodies only). */
  page?: number;
  pageCount?: number;
  /** Effective render scale (1 = 100%); drives the toolbar percentage. */
  scale?: number;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  /**
   * False when a quote was expected but could not be located (drives the
   * honesty footer). Leave true when no quote is present (nothing expected).
   */
  quoteLocated?: boolean;
}

/** Commands a body registers with the frame; the toolbar invokes them. */
export interface CitedSourceBodyCommands {
  goToPage?: (page: number) => void;
  /** Relative render-scale change (e.g. ±0.2 from the −/+ buttons). */
  zoomBy?: (delta: number) => void;
  /** Back to the body's natural fit (fit-width for PDF). */
  resetZoom?: () => void;
}

/**
 * The props contract EVERY body renderer implements — the FROZEN body-facing
 * seam. v2 (docx/pptx) and v3 (image-bbox) bodies plug in through
 * `registerBodyRenderer()` with this exact surface — the frame is closed for
 * modification, open for new bodies.
 *
 * `P` is the body's CONCRETE payload type (architect API review, touch 1):
 * each body declares the payload it renders — `CitedSourceBodyProps<
 * TextSourcePayload>` for the markdown body, `CitedSourceBodyProps<
 * PdfSourcePayload>` for the pdf body, `CitedSourceBodyProps<DocxPayload>`
 * for a custom v2 body — so `payload` is fully narrowed inside the body.
 */
export interface CitedSourceBodyProps<P extends SourcePayloadBase = SourcePayload> {
  /** The active citation ref (locators + quote fields). */
  sourceRef: CitedSourceRef;
  /** The resolved payload for `sourceRef` (the frame already ran `resolveSource`). */
  payload: P;
  /** Convenience: the active quote (`excerpt ?? citation ?? null`). */
  quote: string | null;
  /** The frame's scrollable body element (fit-width + scroll-to-highlight). */
  scrollContainer?: HTMLElement | null;
  onStatus?: (status: CitedSourceBodyStatus) => void;
  /** Body calls it with its commands on mount and `null` on teardown. */
  registerCommands?: (commands: CitedSourceBodyCommands | null) => void;
  /** Body-level render failure (bad bytes, worker unavailable over file://…). */
  onRenderError?: (message: string) => void;
}
