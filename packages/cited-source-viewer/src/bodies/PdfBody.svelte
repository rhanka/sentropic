<script>
  /**
   * PDF text-layer body renderer (v1, LM-1b — pdf.js).
   *
   * Implements the `CitedSourceBodyProps` seam: loads the resolved bytes with
   * the memoized pdf.js engine, renders the active page at fit-width (or the
   * user zoom), computes the text-layer highlight rects for the quote, and
   * reports `{ pageAddressable: true, page, pageCount, scale, … }` up to the
   * frame. Registers `goToPage` / `zoomBy` / `resetZoom` commands — the FRAME
   * renders the toolbar; this body only executes.
   */
  import { tick } from "svelte";
  import {
    MAX_RENDER_SCALE,
    MIN_RENDER_SCALE,
    computeHighlightRects,
    loadPdfDocument,
    renderPdfPage,
  } from "../pdfEngine.js";

  let {
    sourceRef,
    payload,
    quote = null,
    scrollContainer = null,
    onStatus = null,
    registerCommands = null,
    onRenderError = null,
  } = $props();

  let pdfDoc = $state(null);
  let numPages = $state(0);
  let currentPage = $state(1);
  let highlightRects = $state([]);
  let quoteOnPage = $state(true);
  let scale = $state(1); // effective render scale (drives the toolbar %)
  let userScale = null; // manual zoom; null = fit-width (default)
  let canvasEl = $state(null);

  // Token guards: a newer load/render invalidates in-flight older ones.
  let loadToken = 0;
  let renderToken = 0;

  // (Re)load whenever the payload identity changes (the frame re-resolves per ref).
  $effect(() => {
    if (payload) void load(payload);
  });

  async function load(target) {
    const token = ++loadToken;
    renderToken++;
    pdfDoc = null;
    numPages = 0;
    highlightRects = [];
    quoteOnPage = true;
    userScale = null; // a new source starts back in fit-width (radar #90)
    try {
      const doc = await loadPdfDocument(target.data);
      if (token !== loadToken) return;
      pdfDoc = doc;
      numPages = doc.numPages;
      const wanted = Number(sourceRef?.page);
      const initial =
        Number.isFinite(wanted) && wanted >= 1 && wanted <= doc.numPages ? wanted : 1;
      await renderPage(initial);
    } catch (err) {
      if (token !== loadToken) return;
      onRenderError?.(err instanceof Error ? err.message : String(err));
    }
  }

  async function renderPage(pageNumber) {
    if (!pdfDoc) return;
    const token = ++renderToken;
    const clamped = Math.min(Math.max(pageNumber, 1), numPages || 1);
    currentPage = clamped;
    const pdfPage = await pdfDoc.getPage(clamped);
    if (token !== renderToken) return;
    await tick();
    if (!canvasEl) return;
    const containerWidth = scrollContainer
      ? Math.max(120, scrollContainer.clientWidth - 32)
      : 720;
    const rendered = await renderPdfPage(pdfPage, canvasEl, { containerWidth, userScale });
    if (token !== renderToken) return;
    scale = rendered.scale;

    // Highlight only on the ref's own page (radar bug #83 guard: a generic
    // fallback window would otherwise re-highlight on EVERY page).
    const refPage = Number(sourceRef?.page);
    const onRefPage = !Number.isFinite(refPage) || refPage === clamped;
    if (quote && onRefPage) {
      const content = await pdfPage.getTextContent();
      if (token !== renderToken) return;
      const { rects } = computeHighlightRects(content, rendered.viewport, rendered.scale, quote);
      highlightRects = rects;
      quoteOnPage = rects.length > 0;
      if (rects.length > 0) queueScrollToHighlight(rects[0]);
    } else {
      highlightRects = [];
      // Off the ref page: nothing is expected to highlight — not a degradation.
      quoteOnPage = !quote || !onRefPage ? true : false;
    }
    publishStatus();
  }

  // ── Zoom (immo "− 136% +"): manual render-scale override; reset = fit-width.
  function setUserScale(next) {
    const clamped = Math.max(MIN_RENDER_SCALE, Math.min(MAX_RENDER_SCALE, next));
    if (userScale !== null && Math.abs(clamped - userScale) < 0.001) return;
    userScale = clamped;
    if (pdfDoc) void renderPage(currentPage);
  }
  function zoomBy(delta) {
    setUserScale((userScale ?? scale) + delta);
  }
  function resetZoom() {
    if (userScale === null) return;
    userScale = null;
    if (pdfDoc) void renderPage(currentPage);
  }
  function goToPage(page) {
    if (!pdfDoc) return;
    if (page < 1 || page > numPages || page === currentPage) return;
    void renderPage(page);
  }

  function publishStatus() {
    onStatus?.({
      pageAddressable: true,
      page: currentPage,
      pageCount: numPages,
      scale,
      canZoomIn: scale < MAX_RENDER_SCALE - 0.001,
      canZoomOut: scale > MIN_RENDER_SCALE + 0.001,
      quoteLocated: quoteOnPage,
    });
  }

  $effect(() => {
    registerCommands?.({ goToPage, zoomBy, resetZoom });
    return () => registerCommands?.(null);
  });

  /** rAF with a setTimeout fallback (jsdom test environments may lack rAF). */
  function raf(fn) {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  }

  function queueScrollToHighlight(rect) {
    raf(() => {
      if (!scrollContainer || typeof scrollContainer.scrollTo !== "function") return;
      const top = rect.top - scrollContainer.clientHeight / 3;
      scrollContainer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }
</script>

<div class="csv-page-stage">
  <canvas bind:this={canvasEl}></canvas>
  <div class="csv-hl-layer" aria-hidden="true">
    {#each highlightRects as r, i (i)}
      <div
        class="csv-hl"
        style="left:{r.left}px; top:{r.top}px; width:{r.width}px; height:{r.height}px;"
      ></div>
    {/each}
  </div>
</div>

<style>
  .csv-page-stage {
    position: relative;
    width: max-content;
    margin: 0 auto;
    box-shadow: var(--st-shadow-sm, 0 1px 6px rgba(15, 23, 42, 0.18));
  }
  .csv-page-stage canvas {
    display: block;
    background: #fff; /* PDF paper is white regardless of theme */
  }
  .csv-hl-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .csv-hl {
    position: absolute;
    background: color-mix(in srgb, var(--st-semantic-feedback-warning, #eab308) 40%, transparent);
    outline: 1px solid color-mix(in srgb, var(--st-semantic-feedback-warning, #eab308) 85%, transparent);
    border-radius: 2px;
  }
</style>
