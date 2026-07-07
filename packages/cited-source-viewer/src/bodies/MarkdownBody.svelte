<script>
  /**
   * Markdown / plain-text body renderer (v1, LM-1a).
   *
   * Implements the `CitedSourceBodyProps` seam: renders the resolved text with
   * the active quote wrapped in a <mark> (renderSourceHtml is escape-safe) and
   * reports `{ pageAddressable: false, quoteLocated }` to the frame. Registers
   * no commands (nothing page-addressable to drive).
   */
  import { tick } from "svelte";
  import { renderSourceHtml } from "../markdownSource.js";

  let {
    sourceRef,
    payload,
    quote = null,
    scrollContainer = null,
    onStatus = null,
    registerCommands = null,
    onRenderError = null,
  } = $props();

  const rendered = $derived(renderSourceHtml(payload?.text ?? "", quote));

  let rootEl = $state(null);

  /** rAF with a setTimeout fallback (jsdom test environments may lack rAF). */
  function raf(fn) {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
    else setTimeout(fn, 0);
  }

  // Report status + scroll the mark into view on every (re)render of the ref.
  $effect(() => {
    const r = rendered;
    onStatus?.({
      pageAddressable: false,
      quoteLocated: quote ? r.found : true,
    });
    void tick().then(() => {
      raf(() => {
        const mark = rootEl?.querySelector("[data-csv-mark]");
        if (mark && typeof mark.scrollIntoView === "function") {
          mark.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    });
  });

  $effect(() => {
    registerCommands?.(null);
    return () => registerCommands?.(null);
  });
</script>

<!-- Safe: renderSourceHtml escapes everything before re-enabling minimal markup. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="csv-md" bind:this={rootEl}>{@html rendered.html}</div>

<style>
  .csv-md {
    max-width: 46rem;
    margin: 0 auto;
    background: var(--st-semantic-surface-default, #fff);
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-md, 6px);
    padding: 1rem 1.25rem;
    font-size: 0.88rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .csv-md :global(.csv-md-h) {
    margin: 1rem 0 0.4rem;
    font-size: 0.95rem;
    color: var(--st-semantic-text-primary, #0f172a);
  }
  .csv-md :global(.csv-md-p) {
    margin: 0 0 0.6rem;
  }
  .csv-md :global(.csv-mark) {
    background: color-mix(in srgb, var(--st-semantic-feedback-warning, #eab308) 38%, transparent);
    border-radius: 2px;
    padding: 0 0.1em;
  }
</style>
