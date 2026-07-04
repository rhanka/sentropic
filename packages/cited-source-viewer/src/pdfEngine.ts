/**
 * pdf.js engine for the cited-source viewer: lazy module + worker singleton,
 * page rendering, and text-layer highlight-rect computation.
 *
 * NO graphify import. TypeScript port of the qualified graphify interim
 * `studio/src/lib/cited-source/pdfEngine.js`, seeded from radar-immobilier
 * `SignalPdfOverlay.svelte` (#82/#89 lessons kept):
 *   - pdf.js + its worker are imported ONCE and memoized (module-level), so
 *     reopening the viewer never re-imports nor re-wires the worker;
 *   - highlight rect POSITION is projected through viewport.transform (which
 *     already carries the render scale) while DIMENSIONS (item transform b/d +
 *     item.width) are in PDF space and must be multiplied by the render scale
 *     (radar bug #82 — mixing the two spaces skews highlights when zooming).
 *
 * Worker note: by default the worker is bundled by Vite via the `?url` asset
 * import, so it works when the consumer bundle is SERVED (http/https, dev or
 * static export). Over `file://` (single-file exports) module workers cannot
 * load — the body surfaces the load error; PDF sources are not inlined in
 * single-file bundles anyway. Non-Vite consumers call `setPdfWorkerSrc(url)`
 * BEFORE the first PDF load to wire the worker themselves.
 */

import { buildPageText, findCitationInPage } from "./quoteMatch.js";
import type { CitationMatchOptions, PdfTextItemLike } from "./quoteMatch.js";

/* Minimal structural types for the pdf.js surface this engine touches. The
 * real `pdfjs-dist` types stay a consumer-side (peer) concern — keeping the
 * package typecheck hermetic. */
export interface PdfViewportLike {
  transform: number[];
  width: number;
  height: number;
}
export interface PdfPageLike {
  getViewport(options: { scale: number }): PdfViewportLike;
  render(options: { canvasContext: unknown; viewport: PdfViewportLike }): {
    promise: Promise<unknown>;
  };
  getTextContent(): Promise<{ items: PdfTextItemLike[] }>;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfJsModuleLike {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<PdfDocumentLike>;
  };
}

let pdfjsPromise: Promise<PdfJsModuleLike> | null = null;
let workerSrcOverride: string | null = null;

/**
 * Non-Vite consumers (or CSP-restricted hosts) provide their own worker URL.
 * Must be called before the first PDF load; resets the memoized module so the
 * next load re-wires the worker.
 */
export function setPdfWorkerSrc(url: string): void {
  workerSrcOverride = url;
  pdfjsPromise = null;
}

/** Memoized pdf.js module with the bundled worker wired once. */
export function getPdfjs(): Promise<PdfJsModuleLike> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJsModuleLike;
      if (workerSrcOverride) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrcOverride;
      } else {
        // Worker served by Vite as a bundled asset URL (no CDN).
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })();
    // Do not memoize a failed import (lets a transient failure retry).
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/** Zoom bounds shared by the fit-width computation and the toolbar zoom. */
export const MIN_RENDER_SCALE = 0.4;
export const MAX_RENDER_SCALE = 4;

export interface ResolveRenderScaleOptions {
  baseWidth: number;
  containerWidth?: number | null;
  userScale?: number | null;
  minScale?: number;
  maxScale?: number;
}

/**
 * Resolve the effective render scale for a page. PURE (unit-tested):
 * - `userScale` set (toolbar zoom) -> clamped user scale, container ignored;
 * - else fit-width: containerWidth / baseWidth, clamped.
 * Mirrors radar's two zoom regimes (#81 fit-width default, #85 manual zoom).
 */
export function resolveRenderScale({
  baseWidth,
  containerWidth = null,
  userScale = null,
  minScale = MIN_RENDER_SCALE,
  maxScale = MAX_RENDER_SCALE,
}: ResolveRenderScaleOptions): number {
  const clamp = (v: number) => Math.max(minScale, Math.min(maxScale, v));
  if (typeof userScale === "number" && Number.isFinite(userScale)) return clamp(userScale);
  const available = Math.max(120, containerWidth ?? baseWidth);
  return clamp(available / Math.max(1, baseWidth));
}

/** Load a PDF document from raw bytes. */
export async function loadPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PdfDocumentLike> {
  const pdfjs = await getPdfjs();
  // pdf.js transfers the buffer to the worker; clone so callers can reuse it
  // (e.g. re-render after an error or page a cached payload).
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  return task.promise;
}

export interface RenderPdfPageOptions {
  containerWidth?: number | null;
  userScale?: number | null;
  minScale?: number;
  maxScale?: number;
}

/**
 * Render one page into a canvas at fit-width scale and return the geometry
 * needed by the highlight pass.
 */
export async function renderPdfPage(
  pdfPage: PdfPageLike,
  canvas: HTMLCanvasElement,
  options: RenderPdfPageOptions = {},
): Promise<{ viewport: PdfViewportLike; scale: number }> {
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const scale = resolveRenderScale({
    baseWidth: baseViewport.width,
    containerWidth: options.containerWidth ?? null,
    userScale: options.userScale ?? null,
    ...(options.minScale != null ? { minScale: options.minScale } : {}),
    ...(options.maxScale != null ? { maxScale: options.maxScale } : {}),
  });
  const viewport = pdfPage.getViewport({ scale });

  const ctx = canvas.getContext("2d");
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return { viewport, scale };
}

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Compute the highlight rectangles for a quote on a page's text content.
 * Pure geometry (testable with plain objects): locate the quote in the
 * concatenated page text, then emit one CSS-pixel rect per overlapping item.
 */
export function computeHighlightRects(
  content: { items?: PdfTextItemLike[] } | null | undefined,
  viewport: PdfViewportLike,
  renderScale: number,
  quote: string | null | undefined,
  matchOptions: CitationMatchOptions = {},
): { rects: HighlightRect[]; coverage: number } {
  const { pageText, offsets } = buildPageText(content?.items ?? []);
  const match = findCitationInPage(pageText, quote ?? "", matchOptions);
  if (!match) return { rects: [], coverage: 0 };

  const vt = viewport.transform;
  const rects: HighlightRect[] = [];
  for (const { start, end, item } of offsets) {
    if (end <= match.start || start >= match.end) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [0, 0, 0, 0, 0, 0];
    const [, b = 0, , d = 0, e = 0, f = 0] = transform;
    // POSITION: projected into viewport space via viewport.transform (already
    // carries renderScale). DIMENSIONS: item.transform (b, d) and item.width
    // are PDF-space (scale 1) and MUST be multiplied by renderScale (radar #82).
    const tx = (vt[0] ?? 0) * e + (vt[2] ?? 0) * f + (vt[4] ?? 0);
    const ty = (vt[1] ?? 0) * e + (vt[3] ?? 0) * f + (vt[5] ?? 0);
    const fontHeight = (Math.hypot(b, d) || (typeof item.height === "number" ? item.height : 0) || 10) * renderScale;
    const width = Math.max((typeof item.width === "number" ? item.width : 0) * renderScale, 4);
    rects.push({
      left: tx,
      top: ty - fontHeight,
      width,
      height: fontHeight * 1.15,
    });
  }
  return { rects, coverage: match.coverage };
}
