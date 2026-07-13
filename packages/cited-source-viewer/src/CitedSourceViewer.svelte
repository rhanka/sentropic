<script>
  /**
   * @sentropic/cited-source-viewer — the canonical S.6 frame
   * (architect-ratified §S.5 2026-07-04; principal-qualified UX 2026-07-04,
   * immo/radar SignalPdfOverlay parity — "one UX, many bodies").
   *
   * PURITY CONTRACT (§S.5(b), enforced by tests/purity.spec.ts): this
   * component imports NOTHING from graphify — only Svelte, the design system
   * (`@sentropic/design-system-svelte`), and the package's own pure modules.
   * All consumer glue (reading node.citations, projecting to CitedSourceRef,
   * fetching bytes) lives in the consumer adapter (§Lot 4).
   *
   * FRAME (generic, common to ALL modalities):
   *   header   kicker / title / active locator / ✕ close
   *   toolbar  ONE compact DS bar:
   *              ‹ Citation x/y ›  active-ref navigator (shown when y > 1)
   *              [Entité|Sélection] + ‹ Entité x/y ›  scope toggle + group
   *                                navigator (shown when 2+ groups)
   *              ‹ Doc x/y ›       source-document navigator (shown when the
   *                                scoped refs span MULTIPLE locators)
   *              ‹ Page x/y ›      body segment (page-addressable bodies only)
   *              − NN% +           body segment (render-scale zoom; the %
   *                                button resets to the body's natural fit)
   *              Ouvrir ↗          raw source in a new tab (when sourceHref
   *                                resolves a URL)
   *   body     the ONLY modality-specific region — routed by payload.kind to
   *            a body renderer (built-ins: markdown/text + pdf; v2/v3 bodies
   *            plug in via registerBodyRenderer, the frame never changes)
   *   footer   degradation strip, shown ONLY when honesty requires it
   *
   * The component is NON-modal by design: the consumer hosts it as a central
   * overlay (over its canvas/main view only) and keeps its side panels live; a
   * NEW `refs`/`groups` array + `activeIndex` RETARGETS an open viewer (no
   * stacking). Props/typing: see `types.ts` (`CitedSourceViewerProps`).
   */
  import { Button, ContentSwitcher, IconButton, Link } from "@sentropic/design-system-svelte";

  import { getBodyRenderer } from "./bodies/registry.js";
  import MarkdownBody from "./bodies/MarkdownBody.svelte";
  import PdfBody from "./bodies/PdfBody.svelte";

  /** v1 built-in bodies; explicit registry entries take precedence. */
  const BUILTIN_BODIES = { markdown: MarkdownBody, text: MarkdownBody, pdf: PdfBody };

  const DEFAULT_LABELS = {
    kicker: "Cited source",
    citation: "Citation",
    doc: "Doc",
    page: "Page",
    entity: "Entité",
    selection: "Sélection",
    open: "Ouvrir ↗",
    close: "Close source viewer",
    scopeToggle: "Navigation scope",
    loading: "Loading source…",
    noSelection: "No citation selected.",
    unavailableTitle: "Source unavailable",
    zoomReset: "Back to fit-width",
    notLocatedOnPage: "Quote not located on this page — showing the page anyway.",
    notLocatedInDoc: "Quote not located in the source — showing the document anyway.",
    previousCitation: "Previous citation",
    nextCitation: "Next citation",
    previousDocument: "Previous document",
    nextDocument: "Next document",
    previousEntity: "Previous entity",
    nextEntity: "Next entity",
    previousPage: "Previous page",
    nextPage: "Next page",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
  };

  let {
    refs = [],
    groups = null,
    activeGroupIndex = 0,
    activeIndex = 0,
    scope = "entity",
    title = "Cited source",
    resolveSource,
    sourceHref = null,
    onClose = null,
    onFocusChange = null,
    onFocusDetail = null,
    onScopeChange = null,
    labels = {},
    class: className = "",
  } = $props();

  const L = $derived({ ...DEFAULT_LABELS, ...labels });

  // Active (group, ref) position — internal state seeded from the props.
  // Tracking BOTH the groups/refs identity and the index props makes a re-open
  // with the same indexes on a new thread retarget correctly (no stale focus).
  let gIndex = $state(0);
  let rIndex = $state(0);
  let lastActiveProp = -1;
  let lastActiveGroupProp = -1;
  let lastRefsProp = null;
  let lastGroupsProp = null;

  // Navigation scope (§S.6.1). Seeded from the `scope` prop in its own effect
  // so a consumer scope echo never re-seeds an internally navigated position.
  let scopeState = $state("entity");
  let lastScopeProp = null;

  // ── Grouped thread normalization (§S.6.1). Flat `refs` mode is ONE
  // anonymous group, so every navigator below runs off the same structure.
  const normGroups = $derived(
    Array.isArray(groups) && groups.length > 0
      ? groups
      : refs.length > 0
        ? [{ id: null, label: null, refs }]
        : [],
  );
  const groupRefs = (g) => (Array.isArray(g?.refs) ? g.refs : []);
  const activeGroup = $derived(normGroups[gIndex] ?? null);
  const ref = $derived(groupRefs(activeGroup)[rIndex] ?? null);

  // The FLAT thread: every (group, ref) position in order. Sélection scope
  // navigates this list continuously across entity boundaries.
  const thread = $derived.by(() => {
    const items = [];
    normGroups.forEach((g, gi) => {
      groupRefs(g).forEach((r, ri) => items.push({ gi, ri, ref: r }));
    });
    return items;
  });

  // Scope eligibility is based ONLY on groups that carry refs. Empty groups do
  // not create a scope toggle or an entity navigator.
  const entityOrder = $derived(
    normGroups.map((g, gi) => (groupRefs(g).length > 0 ? gi : -1)).filter((gi) => gi >= 0),
  );
  const scopeEligible = $derived(entityOrder.length >= 2);
  const effectiveScope = $derived(scopeEligible && scopeState === "selection" ? "selection" : "entity");
  const entityPos = $derived(entityOrder.indexOf(gIndex));

  // The ACTIVE-SCOPE item list drives citation and document navigation.
  const scopeItems = $derived(
    effectiveScope === "selection" ? thread : thread.filter((it) => it.gi === gIndex),
  );
  const scopePos = $derived(scopeItems.findIndex((it) => it.gi === gIndex && it.ri === rIndex));
  const scopeCount = $derived(scopeItems.length);

  $effect(() => {
    if (
      groups !== lastGroupsProp ||
      refs !== lastRefsProp ||
      activeGroupIndex !== lastActiveGroupProp ||
      activeIndex !== lastActiveProp
    ) {
      lastGroupsProp = groups;
      lastRefsProp = refs;
      lastActiveGroupProp = activeGroupIndex;
      lastActiveProp = activeIndex;
      const gi = Math.max(0, Math.min(normGroups.length - 1, activeGroupIndex ?? 0));
      const seeded = normGroups.length > 0 ? gi : 0;
      const count = groupRefs(normGroups[seeded]).length;
      gIndex = seeded;
      rIndex = count > 0 ? Math.max(0, Math.min(count - 1, activeIndex ?? 0)) : 0;
    }
  });

  $effect(() => {
    if (scope !== lastScopeProp) {
      lastScopeProp = scope;
      scopeState = scope === "selection" ? "selection" : "entity";
    }
  });

  const quoteOf = (r) => r?.excerpt ?? r?.citation ?? null;
  const locatorOf = (r) => r?.rawRef ?? r?.sourceUrl ?? r?.docSha ?? "";

  function buildFocusDetail(gi, ri) {
    const nextRef = groupRefs(normGroups[gi])[ri] ?? null;
    if (!nextRef) return null;
    const items = effectiveScope === "selection" ? thread : thread.filter((it) => it.gi === gi);
    const locators = [];
    for (const it of items) {
      const loc = locatorOf(it.ref);
      if (!locators.includes(loc)) locators.push(loc);
    }
    const docLocator = locatorOf(nextRef);
    return {
      index: thread.findIndex((it) => it.gi === gi && it.ri === ri),
      ref: nextRef,
      scope: effectiveScope,
      groupId: normGroups[gi]?.id ?? null,
      groupIndex: gi,
      groupRefIndex: ri,
      docLocator,
      docIndex: locators.indexOf(docLocator),
      docCount: locators.length,
    };
  }

  /** Move the focus and notify the consumer only for in-viewer navigation. */
  function focusTo(gi, ri) {
    if (gi === gIndex && ri === rIndex) return;
    gIndex = gi;
    rIndex = ri;
    onFocusChange?.(normGroups[gi]?.id ?? null, ri);
    const detail = buildFocusDetail(gi, ri);
    if (detail) onFocusDetail?.(detail);
  }

  /** Next/prev citation in the ACTIVE scope (toolbar ‹ › and n/N). */
  function goScopeRef(delta) {
    const target = scopePos + delta;
    if (target < 0 || target >= scopeCount) return;
    const item = scopeItems[target];
    focusTo(item.gi, item.ri);
  }

  /** Next/prev entity (Sélection scope): first citation of the neighbour group. */
  function goEntity(delta) {
    const target = entityPos + delta;
    if (target < 0 || target >= entityOrder.length) return;
    focusTo(entityOrder[target], 0);
  }

  function setScope(next) {
    if (next !== "entity" && next !== "selection") return;
    if (scopeState === next) return;
    scopeState = next;
    onScopeChange?.(next);
  }

  // ── Document navigator (immo "PDF x/y") over the SCOPED thread ──────────
  const docLocators = $derived.by(() => {
    const seen = [];
    for (const it of scopeItems) {
      const loc = locatorOf(it.ref);
      if (!seen.includes(loc)) seen.push(loc);
    }
    return seen;
  });
  const docCount = $derived(docLocators.length);
  const docIndex = $derived(ref ? docLocators.indexOf(locatorOf(ref)) : -1);
  function goDoc(delta) {
    const target = docIndex + delta;
    if (target < 0 || target >= docCount) return;
    const loc = docLocators[target];
    const first = scopeItems.find((it) => locatorOf(it.ref) === loc);
    if (first) focusTo(first.gi, first.ri);
  }

  const rawHref = $derived(
    ref && typeof sourceHref === "function" ? (sourceHref(ref) ?? null) : null,
  );

  const displayTitle = $derived(
    activeGroup?.label ? [activeGroup.label, locatorOf(ref)].filter(Boolean).join(" — ") : title,
  );

  /** Human locator label for the header ("p.3", "§ Chapter 2", …). */
  function locatorLabel(r) {
    if (!r) return "";
    const parts = [];
    if (r.page != null) parts.push(`p.${r.page}`);
    if (r.section) parts.push(r.section);
    else if (r.paragraph_id) parts.push(`¶${r.paragraph_id}`);
    return parts.join(" · ");
  }

  // ── Load pipeline (frame resolves; the body renders) ─────────────────────
  let loading = $state(false);
  let loadError = $state(null);
  let payload = $state(null);
  let BodyComponent = $state(null);
  let bodyStatus = $state(null);
  let bodyCommands = null;
  let scrollEl = $state(null);
  let loadToken = 0;

  $effect(() => {
    if (ref && typeof resolveSource === "function") void load(ref);
  });

  async function load(target) {
    const token = ++loadToken;
    loading = true;
    loadError = null;
    payload = null;
    BodyComponent = null;
    bodyStatus = null;
    bodyCommands = null;
    try {
      const resolved = await resolveSource(target);
      if (token !== loadToken) return;
      const kind = resolved && typeof resolved.kind === "string" ? resolved.kind : null;
      const body = kind ? (getBodyRenderer(kind) ?? BUILTIN_BODIES[kind] ?? null) : null;
      if (!body) {
        throw new Error(
          `unsupported source payload kind "${kind ?? "?"}" (no body renderer registered)`,
        );
      }
      payload = resolved;
      BodyComponent = body;
      // Markdown/text can show as soon as the payload is resolved. PDF keeps
      // the frame in loading state until PdfBody reports its first rendered
      // status, avoiding a transient blank canvas.
      loading = kind === "pdf";
    } catch (err) {
      if (token !== loadToken) return;
      loading = false;
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function onBodyStatus(status) {
    bodyStatus = status;
    if (loading) loading = false;
  }
  function setBodyCommands(commands) {
    bodyCommands = commands;
  }
  function onBodyRenderError(message) {
    loading = false;
    loadError = message;
    payload = null;
    BodyComponent = null;
    bodyStatus = null;
    bodyCommands = null;
  }

  const pageAddressable = $derived(Boolean(bodyStatus?.pageAddressable));
  const zoomPct = $derived(Math.round((bodyStatus?.scale ?? 1) * 100));

  function goPage(delta) {
    if (!bodyCommands?.goToPage || !bodyStatus) return;
    bodyCommands.goToPage((bodyStatus.page ?? 1) + delta);
  }

  /** True when the key event belongs to a form field. The overlay is NON-modal
   *  (side panels stay interactive), so typing there must never page/close. */
  function isEditableTarget(event) {
    const el = event.target;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(
      el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"),
    );
  }
  function handleKeydown(event) {
    if (isEditableTarget(event)) return;
    if (event.key === "Escape" && onClose) onClose();
    else if (event.key === "ArrowLeft" && pageAddressable) goPage(-1);
    else if (event.key === "ArrowRight" && pageAddressable) goPage(1);
    else if (event.key === "n") goScopeRef(1);
    else if (event.key === "N") goScopeRef(-1);
    else if (event.key === "e" && effectiveScope === "selection") goEntity(1);
    else if (event.key === "E" && effectiveScope === "selection") goEntity(-1);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="csv {className}" aria-label="Cited source viewer">
  <header class="csv-head">
    <div class="csv-head-text">
      <p class="csv-kicker">{L.kicker}</p>
      <h2 class="csv-title" title={locatorOf(ref)}>{displayTitle}</h2>
      {#if ref}
        <p class="csv-locator">
          <span class="csv-locator-file">{locatorOf(ref) || "(no locator)"}</span>
          {#if locatorLabel(ref)}<span class="csv-locator-pos">{locatorLabel(ref)}</span>{/if}
        </p>
      {/if}
    </div>
    {#if onClose}
      <IconButton size="sm" aria-label={L.close} onclick={() => onClose()}>✕</IconButton>
    {/if}
  </header>

  <!-- QUALIFIED TOOLBAR (immo parity): one compact DS bar, generic frame; only
       the Page/Zoom segments are body-gated (page-addressable bodies). -->
  <div class="csv-toolbar" role="toolbar" aria-label="Source navigation">
    {#if scopeEligible}
      <ContentSwitcher
        size="sm"
        label={L.scopeToggle}
        class="csv-tb-scope"
        value={effectiveScope}
        items={[
          { value: "entity", label: L.entity },
          { value: "selection", label: L.selection },
        ]}
        onchange={(value) => setScope(value)}
      />
    {/if}

    {#if scopeCount > 1}
      <div class="csv-tb-group" aria-label="Citation navigator">
        <IconButton size="sm" aria-label={L.previousCitation} disabled={scopePos <= 0} onclick={() => goScopeRef(-1)}>‹</IconButton>
        <span class="csv-tb-label">{L.citation} <strong>{scopePos + 1}/{scopeCount}</strong></span>
        <IconButton size="sm" aria-label={L.nextCitation} disabled={scopePos >= scopeCount - 1} onclick={() => goScopeRef(1)}>›</IconButton>
      </div>
    {/if}

    {#if scopeEligible && effectiveScope === "selection"}
      <div class="csv-tb-group" aria-label="Entity navigator">
        <IconButton size="sm" aria-label={L.previousEntity} disabled={entityPos <= 0} onclick={() => goEntity(-1)}>‹</IconButton>
        <span class="csv-tb-label">
          {L.entity} <strong>{entityPos + 1}/{entityOrder.length}</strong>
          {#if activeGroup?.label}<span class="csv-tb-entity">— {activeGroup.label}</span>{/if}
        </span>
        <IconButton size="sm" aria-label={L.nextEntity} disabled={entityPos >= entityOrder.length - 1} onclick={() => goEntity(1)}>›</IconButton>
      </div>
    {/if}

    {#if docCount > 1}
      <div class="csv-tb-group" aria-label="Document navigator">
        <IconButton size="sm" aria-label={L.previousDocument} disabled={docIndex <= 0} onclick={() => goDoc(-1)}>‹</IconButton>
        <span class="csv-tb-label">{L.doc} <strong>{docIndex + 1}/{docCount}</strong></span>
        <IconButton size="sm" aria-label={L.nextDocument} disabled={docIndex >= docCount - 1} onclick={() => goDoc(1)}>›</IconButton>
      </div>
    {/if}

    {#if pageAddressable}
      <div class="csv-tb-group" aria-label="Page navigator">
        <IconButton size="sm" aria-label={L.previousPage} disabled={(bodyStatus?.page ?? 1) <= 1} onclick={() => goPage(-1)}>‹</IconButton>
        <span class="csv-tb-label">{L.page} <strong>{bodyStatus?.page ?? 1}/{bodyStatus?.pageCount ?? 1}</strong></span>
        <IconButton size="sm" aria-label={L.nextPage} disabled={(bodyStatus?.page ?? 1) >= (bodyStatus?.pageCount ?? 1)} onclick={() => goPage(1)}>›</IconButton>
      </div>

      <div class="csv-tb-group" aria-label="Zoom">
        <IconButton size="sm" aria-label={L.zoomOut} disabled={!bodyStatus?.canZoomOut} onclick={() => bodyCommands?.zoomBy?.(-0.2)}>−</IconButton>
        <Button
          variant="ghost"
          size="sm"
          class="csv-tb-zoom"
          title={L.zoomReset}
          aria-label="Zoom level {zoomPct} percent, click to reset"
          onclick={() => bodyCommands?.resetZoom?.()}
        >{zoomPct}%</Button>
        <IconButton size="sm" aria-label={L.zoomIn} disabled={!bodyStatus?.canZoomIn} onclick={() => bodyCommands?.zoomBy?.(0.2)}>+</IconButton>
      </div>
    {/if}

    <span class="csv-tb-spacer"></span>

    {#if rawHref}
      <Link class="csv-tb-open" href={rawHref} external variant="standalone">{L.open}</Link>
    {/if}
  </div>

  {#if quoteOf(ref)}
    <blockquote class="csv-quote">{quoteOf(ref)}</blockquote>
  {/if}

  <div class="csv-body" bind:this={scrollEl} aria-busy={loading}>
    {#if loadError}
      <div class="csv-error" role="alert">
        <p class="csv-error-title">{L.unavailableTitle}</p>
        <p class="csv-error-detail">{loadError}</p>
        <code class="csv-error-ref">{locatorOf(ref) || "(no locator)"}</code>
      </div>
    {:else if BodyComponent && payload && ref}
      {#if loading}
        <p class="csv-status" role="status">{L.loading}</p>
      {/if}
      <div class:csv-body-stage-loading={loading}>
        {#key payload}
          <BodyComponent
            sourceRef={ref}
            {payload}
            quote={quoteOf(ref)}
            scrollContainer={scrollEl}
            onStatus={onBodyStatus}
            registerCommands={setBodyCommands}
            onRenderError={onBodyRenderError}
          />
        {/key}
      </div>
    {:else if loading}
      <p class="csv-status" role="status">{L.loading}</p>
    {:else}
      <p class="csv-status">{L.noSelection}</p>
    {/if}
  </div>

  {#if bodyStatus && quoteOf(ref) && bodyStatus.quoteLocated === false}
    <footer class="csv-foot">
      <span class="csv-degraded">{pageAddressable ? L.notLocatedOnPage : L.notLocatedInDoc}</span>
    </footer>
  {/if}
</section>

<style>
  .csv {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--st-semantic-surface-default, #fff);
    color: var(--st-semantic-text-primary, #0f172a);
  }
  .csv-head {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.8rem 1rem 0.6rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }
  .csv-head-text {
    flex: 1;
    min-width: 0;
  }
  .csv-kicker {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--st-semantic-text-muted, #64748b);
  }
  .csv-title {
    margin: 0.15rem 0 0.1rem;
    font-size: 1rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .csv-locator {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-size: 0.72rem;
    color: var(--st-semantic-text-muted, #64748b);
  }
  .csv-locator-file {
    font-family: var(--st-font-mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
  }
  .csv-locator-pos {
    font-weight: 600;
    color: var(--st-semantic-text-secondary, #475569);
    white-space: nowrap;
  }
  /* ── Qualified toolbar (immo parity): DS controls, token-only chrome ───── */
  .csv-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding: 0.35rem 1rem;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    min-height: 2.1rem;
  }
  .csv-tb-group {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.2rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: var(--st-radius-sm, 4px);
    background: var(--st-semantic-surface-default, #fff);
  }
  .csv-tb-label {
    font-size: 0.72rem;
    color: var(--st-semantic-text-secondary, #475569);
    padding: 0 0.25rem;
    white-space: nowrap;
  }
  .csv-tb-label strong {
    font-weight: 700;
    color: var(--st-semantic-text-primary, #0f172a);
  }
  .csv-tb-entity {
    display: inline-block;
    vertical-align: bottom;
    margin-left: 0.3rem;
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--st-semantic-text-primary, #0f172a);
    font-weight: 600;
  }
  .csv-toolbar :global(.csv-tb-zoom) {
    min-width: 3rem;
  }
  .csv-tb-spacer {
    flex: 1;
  }
  .csv-quote {
    margin: 0.55rem 1rem 0.2rem;
    padding: 0.3rem 0.6rem;
    border-left: 3px solid var(--st-semantic-action-primary, #2563eb);
    background: var(--st-semantic-surface-subtle, #f8fafc);
    border-radius: 0 var(--st-radius-sm, 4px) var(--st-radius-sm, 4px) 0;
    font-size: 0.8rem;
    font-style: italic;
    line-height: 1.4;
    color: var(--st-semantic-text-primary, #0f172a);
    max-height: 5.6rem;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  .csv-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem 1rem;
    background: var(--st-semantic-surface-sunken, #f1f5f9);
  }
  .csv-body-stage-loading {
    visibility: hidden;
    max-height: 0;
    overflow: hidden;
  }
  .csv-status {
    margin: 2rem 0;
    text-align: center;
    color: var(--st-semantic-text-muted, #64748b);
  }
  .csv-error {
    margin: 1.5rem auto;
    max-width: 28rem;
    text-align: center;
    display: grid;
    gap: 0.35rem;
  }
  .csv-error-title {
    margin: 0;
    font-weight: 700;
    color: var(--st-semantic-feedback-error, #dc2626);
  }
  .csv-error-detail {
    margin: 0;
    font-size: 0.82rem;
    color: var(--st-semantic-text-secondary, #475569);
    overflow-wrap: anywhere;
  }
  .csv-error-ref {
    font-family: var(--st-font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
    color: var(--st-semantic-text-muted, #64748b);
    overflow-wrap: anywhere;
  }
  .csv-foot {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.35rem 1rem;
    border-top: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
  }
  .csv-degraded {
    font-size: 0.74rem;
    font-style: italic;
    color: var(--st-semantic-text-muted, #64748b);
  }
</style>
