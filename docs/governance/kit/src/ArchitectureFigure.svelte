<script>
  import { language, t } from './i18n.js';
  import { tick, mount, unmount } from 'svelte';
  import { Plus, Minus } from '@lucide/svelte';
  import FrameToggle from './FrameToggle.svelte';
  import { Button, Typography } from '@sentropic/design-system-svelte';
  import { renderSceneSvg } from './architecture-svg.js';
  import { projectGovernanceScene } from './governance-projection.js';
  import { collapseGovernanceScene } from './governance-collapse.js';

  let { scene, label, title = 'Architecture', compact = false, highlight = null } = $props();
  let collapsedIds = $state(scene.groups.map(group => group.id));
  let layoutBusy = $state(false);
  let detailRevision = 0;
  let heldInlineSvg = '';
  let overflowDiagnostics = $state([]);
  const foldable = $derived(scene.groups.length > 0);
  $effect(() => { collapsedIds = scene.groups.map(group => group.id); });
  const routed = $derived(collapseGovernanceScene(projectGovernanceScene(scene, highlight), collapsedIds));
  // Only local structured scene text reaches this renderer; it XML-escapes it.
  const svg = $derived(viewerOpen ? heldInlineSvg : renderSceneSvg(scene.id, routed, highlight, foldable));
  // Separate IDs keep marker and accessible-title references local to each SVG.
  const viewerSvg = $derived(viewerOpen ? renderSceneSvg(`${scene.id}-viewer`, routed, highlight, foldable) : '');
  // 100 % means "fit": the whole diagram visible without horizontal scroll
  // (inline) or fitted to the viewport (viewer). Zoom stays vector-only.
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.25;
  let viewerOpen = $state(false);
  let modalFallback = $state(false);
  let dialog;
  let viewport = $state();
  let inlineDiagram = $state();
  let returnFocus;
  let inlineScale = $state(1);
  let inlinePanning = $state(false);
  let inlineStart;
  let inlineMoved = false;
  let viewerScale = $state(1);
  let viewerFit = $state(1);
  let lastViewportSize;
  let offset = $state({ x: 0, y: 0 });
  let dragging = $state(false);
  const pointers = new Map();
  async function scheduleFrameControls() {
    await tick();
    const host = viewerOpen ? viewport : inlineDiagram;
    const diagnostics = [];
    for (const card of host?.querySelectorAll('.service-node') ?? []) {
      const box = card.getBoundingClientRect(), scale = box.width / 460;
      const entity = card.closest('[data-group], [data-node]');
      const slots = [...card.querySelectorAll('.card-code,.service-name,.card-body,.repo-label')];
      const overflowing = slots.filter(slot => {
        const range = document.createRange(); range.selectNodeContents(slot);
        const rect = range.getBoundingClientRect();
        return rect.top < box.top-scale || rect.bottom > box.bottom+scale
          || rect.left < box.left-scale || rect.right > box.right+scale
          || slot.scrollHeight > slot.clientHeight+1 || slot.scrollWidth > slot.clientWidth+1;
      });
      if (overflowing.length) {
        const slots = overflowing.map(slot=>slot.className).join(', ');
        card.dataset.cardOverflow = slots;
        diagnostics.push(`${entity.dataset.group ?? entity.dataset.node}: ${slots}`);
      } else delete card.dataset.cardOverflow;
    }
    if (JSON.stringify(overflowDiagnostics) !== JSON.stringify(diagnostics)) overflowDiagnostics = diagnostics;
  }

  function mountFrameControls(host, markup) {
    if (!host || !markup) return;
    const components = [];
    let cancelled = false;
    tick().then(() => {
      if (cancelled) return;
      for (const target of host.querySelectorAll('[data-frame-mount]')) {
        const group = routed.groups.find(group => group.id === target.dataset.frameMount);
        components.push(mount(FrameToggle, { target, props: { collapsed: !!group.collapsed,
          label: `${t(group.collapsed ? 'Déplier' : 'Replier', $language)} ${group.title}` } }));
      }
      scheduleFrameControls();
    });
    return () => { cancelled = true; for (const component of components) unmount(component); };
  }
  $effect(() => mountFrameControls(inlineDiagram, svg));
  $effect(() => mountFrameControls(viewport, viewerSvg));
  $effect(() => {
    svg; viewerSvg; inlineScale; viewerScale; viewerFit; viewerOpen;
    tick().then(scheduleFrameControls);
  });
  $effect(() => {
    if (!inlineDiagram) return;
    const observer = new ResizeObserver(scheduleFrameControls);
    observer.observe(inlineDiagram);
    if (viewport) observer.observe(viewport);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!inlineDiagram) return;
    const element = inlineDiagram;
    // Ctrl/⌘ + wheel also covers the trackpad pinch; a plain wheel keeps the
    // page scroll and the browser page zoom untouched.
    const wheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      setInlineScale(inlineScale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01), event);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  $effect(() => {
    if (!viewerOpen || !modalFallback) return;
    // Older WebViews without showModal still keep the rest of the dossier
    // outside the accessible/focusable dialog subtree.
    const siblings = [];
    for (let element = dialog; element?.parentElement; element = element.parentElement) {
      for (const sibling of element.parentElement.children) {
        if (sibling !== element) {
          siblings.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      if (element.parentElement === document.body) break;
    }
    return () => { for (const [element, inert] of siblings) element.inert = inert; };
  });

  $effect(() => {
    if (!viewerOpen || !viewport) return;
    const element = viewport;
    // Preserve native browser zoom outside the viewer. Inside it, prevent the
    // WebView from taking over a gesture and cancelling the vector pan/zoom.
    const touchStart = (event) => {
      if (event.target.closest?.('[data-group-toggle]')) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      for (const touch of event.changedTouches) pointers.set(touch.identifier, localPoint(touch));
      dragging = pointers.size > 0;
    };
    const touchMove = (event) => {
      event.preventDefault();
      const before = [...pointers.values()];
      pointers.clear();
      for (const touch of event.touches) pointers.set(touch.identifier, localPoint(touch));
      moveGesture(before, [...pointers.values()]);
    };
    const touchEnd = (event) => {
      for (const touch of event.changedTouches) pointers.delete(touch.identifier);
      dragging = pointers.size > 0;
    };
    const wheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      zoomTo(viewerScale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01), localPoint(event));
    };
    element.addEventListener('touchstart', touchStart, { passive: false });
    element.addEventListener('touchmove', touchMove, { passive: false });
    element.addEventListener('touchend', touchEnd);
    element.addEventListener('touchcancel', touchEnd);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', touchEnd);
      element.removeEventListener('touchcancel', touchEnd);
      element.removeEventListener('wheel', wheel);
    };
  });

  $effect(() => {
    if (!viewerOpen || !viewport) return;
    // A rotated or resized viewport keeps the fitted diagram fitted.
    const refit = () => {
      const { width, height } = viewerSvgSize();
      const clientWidth = viewport.clientWidth;
      const clientHeight = viewport.clientHeight;
      const next = Math.min(clientWidth / width, clientHeight / height);
      // Anchor the content point that sat under the pre-resize centre onto the
      // new centre; using the new centre on both sides would drift the fit.
      const previous = lastViewportSize ?? { width: clientWidth, height: clientHeight };
      const centerX = previous.width / 2;
      const centerY = previous.height / 2;
      lastViewportSize = { width: clientWidth, height: clientHeight };
      const ratio = next / viewerFit;
      if (ratio === 1) return;
      offset = {
        x: clientWidth / 2 - (centerX - offset.x) * ratio,
        y: clientHeight / 2 - (centerY - offset.y) * ratio,
      };
      viewerFit = next;
    };
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  });

  async function openViewer(event) {
    if (viewerOpen) return;
    returnFocus = event?.currentTarget ?? document.activeElement;
    heldInlineSvg = svg;
    lastViewportSize = undefined;
    viewerOpen = true;
    await tick();
    modalFallback = typeof dialog.showModal !== 'function';
    if (!modalFallback) dialog.showModal();
    else dialog.setAttribute('open', '');
    fitViewer();
    dialog.querySelector('[data-viewer-close]').focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!viewerOpen) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    finishClose();
  }

  function finishClose() {
    if (!viewerOpen) return;
    viewerOpen = false;
    pointers.clear();
    dragging = false;
    // Flush the fallback's inert cleanup before restoring the trigger's focus.
    if (modalFallback) { tick().then(() => returnFocus?.focus({ preventScroll: true })); return; }
    returnFocus?.focus({ preventScroll: true });
  }

  function setInlineScale(next, anchor) {
    next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const container = inlineDiagram;
    if (!container || next === inlineScale) return;
    const rect = container.getBoundingClientRect();
    const px = anchor ? anchor.clientX - rect.left : container.clientWidth / 2;
    const py = anchor ? anchor.clientY - rect.top : container.clientHeight / 2;
    const contentX = (container.scrollLeft + px) / inlineScale;
    const contentY = (container.scrollTop + py) / inlineScale;
    inlineScale = next;
    const zoom = container.querySelector('.diagram-zoom');
    if (zoom) zoom.style.width = `${next * 100}%`;
    // Keep the point under the pointer (or the visible centre) stationary.
    container.scrollLeft = contentX * next - px;
    container.scrollTop = contentY * next - py;
  }

  function fitInline() {
    inlineScale = 1;
    if (!inlineDiagram) return;
    const zoom = inlineDiagram.querySelector('.diagram-zoom');
    if (zoom) zoom.style.width = '100%';
    inlineDiagram.scrollLeft = 0;
    inlineDiagram.scrollTop = 0;
  }

  function viewerSvgSize() {
    const svgElement = viewport.querySelector('svg');
    return { width: svgElement.width.baseVal.value, height: svgElement.height.baseVal.value };
  }

  function fitViewer() {
    const { width, height } = viewerSvgSize();
    const size = lastViewportSize ?? { width: viewport.clientWidth, height: viewport.clientHeight };
    // The whole diagram visible at opening, at 100 % of the fit size.
    viewerFit = Math.min(size.width / width, size.height / height);
    viewerScale = 1;
    offset = {
      x: Math.max(0, (size.width - width * viewerFit) / 2),
      y: Math.max(0, (size.height - height * viewerFit) / 2),
    };
    lastViewportSize = size;
  }

  function zoomTo(nextScale, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));
    const ratio = nextScale / viewerScale;
    offset = { x: point.x - (point.x - offset.x) * ratio, y: point.y - (point.y - offset.y) * ratio };
    viewerScale = nextScale;
  }

  function localPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function moveGesture(before, after) {
    if (before.length === 1 && after.length === 1) {
      offset = { x: offset.x + after[0].x - before[0].x, y: offset.y + after[0].y - before[0].y };
    } else if (before.length === 2 && after.length === 2) {
      const midpoint = (points) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const distance = (points) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const oldCenter = midpoint(before);
      const center = midpoint(after);
      const oldDistance = distance(before);
      if (oldDistance > 0) zoomTo(viewerScale * distance(after) / oldDistance, oldCenter);
      offset = { x: offset.x + center.x - oldCenter.x, y: offset.y + center.y - oldCenter.y };
    }
  }

  function inlinePointerDown(event) {
    if (event.target.closest?.('[data-group-toggle]')) { inlineStart = null; return; }
    if (!event.isPrimary || event.button !== 0) { inlineMoved = true; return; }
    inlineStart = {
      x: event.clientX,
      y: event.clientY,
      scroll: inlineDiagram.scrollLeft,
      top: inlineDiagram.scrollTop,
      pan: event.pointerType !== 'touch' && inlineScale > 1,
    };
    inlineMoved = false;
    // Touch keeps native scrolling and the browser page pinch-zoom.
    if (inlineStart.pan) {
      inlineDiagram.setPointerCapture?.(event.pointerId);
      inlinePanning = true;
    }
  }

  function inlinePointerMove(event) {
    if (inlineStart?.pan && inlinePanning) {
      inlineDiagram.scrollLeft = inlineStart.scroll - (event.clientX - inlineStart.x);
      inlineDiagram.scrollTop = inlineStart.top - (event.clientY - inlineStart.y);
    }
    if (inlineStart && Math.hypot(event.clientX - inlineStart.x, event.clientY - inlineStart.y) > 8) inlineMoved = true;
  }

  function inlinePointerEnd() {
    inlinePanning = false;
  }

  function inlinePointerCancel() {
    inlinePanning = false;
    inlineMoved = true;
  }

  function inlineClick(event) {
    if (toggleGroup(event)) return;
    if (!inlineMoved && (!inlineStart
      || (inlineDiagram.scrollLeft === inlineStart.scroll && inlineDiagram.scrollTop === inlineStart.top))) openViewer(event);
    inlineStart = null;
  }

  function inlineKeydown(event) {
    if (toggleKey(event)) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openViewer(event); }
  }

  function figureKeydown(event) {
    if (event.target.closest?.('.diagram-viewer, input, textarea, select')) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setInlineScale(inlineScale * ZOOM_STEP); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setInlineScale(inlineScale / ZOOM_STEP); }
    else if (event.key === '0') { event.preventDefault(); fitInline(); }
  }

  function pointerDown(event) {
    if (event.target.closest?.('[data-group-toggle]')) return;
    if (event.pointerType === 'touch' || event.button !== 0) return;
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, localPoint(event));
    dragging = true;
  }

  function pointerMove(event) {
    if (event.pointerType === 'touch') return;
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    pointers.set(event.pointerId, localPoint(event));
    moveGesture(before, [...pointers.values()]);
  }

  function pointerEnd(event) {
    if (event.pointerType === 'touch') return;
    pointers.delete(event.pointerId);
    dragging = pointers.size > 0;
  }

  function viewerKeydown(event) {
    if (toggleKey(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
      return;
    }
    if (event.key === 'Tab') {
      const targets = [...dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    // Zoom keys work from anywhere inside the viewer: focus starts on the
    // close button, so waiting for the viewport would ignore +, − and 0.
    if (event.key === '+' || event.key === '=') zoomTo(viewerScale * ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomTo(viewerScale / ZOOM_STEP);
    else if (event.key === '0') fitViewer();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      offset = { x: offset.x + (event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0),
        y: offset.y + (event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0) };
    } else return;
    event.preventDefault();
  }

  async function setDetail(ids, focusId) {
    const revision = ++detailRevision;
    layoutBusy = true;
    collapsedIds = ids;
    await tick();
    if (revision !== detailRevision) return;
    if (viewerOpen) fitViewer();
    else fitInline();
    // The fitted transform is reactive too. Measure hit targets only once
    // that transform has reached the DOM, and discard superseded re-layouts.
    await tick();
    if (revision !== detailRevision) return;
    await scheduleFrameControls();
    if (revision !== detailRevision) return;
    layoutBusy = false;
    if (focusId) (viewerOpen ? viewport : inlineDiagram)?.querySelector(`[data-group-toggle="${focusId}"]`)?.querySelector('button')?.focus({ preventScroll: true });
  }

  function toggleGroup(event) {
    const button = event.target.closest?.('[data-group-toggle]');
    if (!button) return false;
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.groupToggle;
    const keyboardFocus = event.type === 'keydown' || event.detail === 0;
    setDetail(collapsedIds.includes(id) ? collapsedIds.filter(value => value !== id) : [...collapsedIds, id], keyboardFocus ? id : undefined);
    return true;
  }

  function toggleKey(event) {
    return (event.key === 'Enter' || event.key === ' ') && toggleGroup(event);
  }
</script>

{#snippet mobileFrames()}
  {#if foldable}
    <div class="mobile-frame-controls" role="group" aria-label={t("Déplier ou replier les cadres", $language)}>
      {#each routed.groups as group}
        <Button size="sm" variant="secondary" aria-expanded={!group.collapsed} data-frame-control={group.id}
          aria-label={`${t(group.collapsed ? 'Déplier' : 'Replier', $language)} ${t('le cadre', $language)} ${group.title}`}
          onclick={() => setDetail(group.collapsed ? collapsedIds.filter(id => id !== group.id) : [...collapsedIds, group.id])}>
          {#if group.collapsed}<Plus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" />{:else}<Minus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" />{/if}{group.title}
        </Button>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Keyboard +, − and 0 zoom the diagram from anywhere in the figure.) -->
<figure class="architecture-figure" class:compact aria-label={label}
  aria-busy={layoutBusy}
  data-architecture-scene={scene.id} data-edge-count={scene.edges.length}
  data-node-count={scene.nodes.length} data-renderer="inline-svg" onkeydown={figureKeydown}>
  <Typography variant="h2" as="h3" class="architecture-title">{title}</Typography>
  {#if overflowDiagnostics.length}
    <ul data-diagram-diagnostics aria-label={t('Débordements de texte', $language)}>
      {#each overflowDiagnostics as diagnostic}<li>{diagnostic}</li>{/each}
    </ul>
  {/if}
  <p class="architecture-palette">{t("Ambre : ajout ou choix proposé · Bleu : identité et confiance", $language)}</p>
  <div class="diagram-controls" role="group" aria-label={t("Zoom du diagramme", $language)}>
    <Button size="sm" variant="secondary" aria-label={`${t("Dézoomer : ", $language)}${title}`} onclick={() => setInlineScale(inlineScale / ZOOM_STEP)} disabled={inlineScale <= ZOOM_MIN}><Minus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" /></Button>
    <output aria-label={t("Niveau de zoom", $language)}><Typography variant="body-sm" as="span">{Math.round(inlineScale * 100)} %</Typography></output>
    <Button size="sm" variant="secondary" aria-label={`${t("Zoomer : ", $language)}${title}`} onclick={() => setInlineScale(inlineScale * ZOOM_STEP)} disabled={inlineScale >= ZOOM_MAX}><Plus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" /></Button>
    <Button size="sm" variant="secondary" aria-label={`${t("Ajuster : ", $language)}${title}`} onclick={fitInline} disabled={inlineScale === 1}>{t("Ajuster", $language)}</Button>
    <Button size="sm" variant="secondary" onclick={openViewer} aria-label={`${t("Agrandir : ", $language)}${title}`} aria-haspopup="dialog">{t("Agrandir", $language)}</Button>
    {#if foldable}
      <Button size="sm" variant="secondary" onclick={() => setDetail([])} disabled={!collapsedIds.length}>{t("Tout déplier", $language)}</Button>
      <Button size="sm" variant="secondary" onclick={() => setDetail(scene.groups.map(group => group.id))} disabled={collapsedIds.length === scene.groups.length}>{t("Tout replier", $language)}</Button>
    {/if}
  </div>
  <p class="diagram-hint">{t("Ctrl + molette ou + / − pour zoomer · Agrandir pour le plein écran", $language)}</p>
  {@render mobileFrames()}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus enables scrolling the zoomed diagram.) -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (The region scrolls when zoomed; Enter opens the dialog.) -->
  <div class="diagram-scroll" class:pannable={inlineScale > 1} class:panning={inlinePanning}
    role="region" aria-label={`${label}${t(" — schéma ; Entrée pour agrandir", $language)}`} tabindex="0"
    bind:this={inlineDiagram} onclick={inlineClick} onkeydown={inlineKeydown}
    onpointerdown={inlinePointerDown} onpointermove={inlinePointerMove}
    onpointerup={inlinePointerEnd} onpointercancel={inlinePointerCancel}>
    <div class="diagram-zoom" style={`width: ${inlineScale * 100}%`}>
      {@html svg}
    </div>
  </div>
  <!-- svelte-ignore a11y_no_redundant_roles (The brief explicitly requests role=dialog.) -->
  <dialog class="diagram-viewer" bind:this={dialog} role="dialog" aria-modal="true" aria-label={title}
    onclose={() => { if (!dialog.open) finishClose(); }} onkeydown={viewerKeydown}
    oncancel={(event) => { event.preventDefault(); closeViewer(); }}>
    {#if viewerOpen}
      <header class="viewer-header">
        <Typography variant="h4" as="h2">{title}</Typography>
        <Button size="sm" variant="secondary" data-viewer-close onclick={closeViewer}>{t("Fermer", $language)}</Button>
      </header>
      <div class="viewer-controls" role="group" aria-label={t("Zoom du diagramme", $language)}>
        <Button size="sm" variant="secondary" aria-label={t("Réduire le diagramme", $language)} onclick={() => zoomTo(viewerScale / ZOOM_STEP)} disabled={viewerScale <= ZOOM_MIN}><Minus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" /></Button>
        <output aria-label={t("Niveau de zoom", $language)}><Typography variant="body-sm" as="span">{Math.round(viewerScale * 100)} %</Typography></output>
        <Button size="sm" variant="secondary" aria-label={t("Agrandir le diagramme", $language)} onclick={() => zoomTo(viewerScale * ZOOM_STEP)} disabled={viewerScale >= ZOOM_MAX}><Plus size="var(--st-component-button-anatomy-density-sm-fontSize)" aria-hidden="true" /></Button>
        <Button size="sm" variant="secondary" onclick={fitViewer}>{t("Ajuster", $language)}</Button>
        {#if foldable}
          <Button size="sm" variant="secondary" onclick={() => setDetail([])} disabled={!collapsedIds.length}>{t("Tout déplier", $language)}</Button>
          <Button size="sm" variant="secondary" onclick={() => setDetail(scene.groups.map(group => group.id))} disabled={collapsedIds.length === scene.groups.length}>{t("Tout replier", $language)}</Button>
        {/if}
          </div>
      <p class="viewer-hint">{t("Pincer ou utiliser la molette pour zoomer · Glisser pour déplacer", $language)}</p>
      {@render mobileFrames()}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users can pan with arrows and zoom with +, − or 0.) -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Pointer handlers pan the SVG; the dialog handles keyboard equivalents.) -->
      <div class="viewer-viewport" class:dragging bind:this={viewport} tabindex="0" role="region" aria-label={t("Diagramme — flèches pour déplacer, + et − pour zoomer, 0 pour ajuster", $language)}
        onclick={toggleGroup}
        onpointerdown={pointerDown} onpointermove={pointerMove}
        onpointerup={pointerEnd} onpointercancel={pointerEnd} onlostpointercapture={pointerEnd}>
        <div class="viewer-transform" style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${viewerFit * viewerScale})`}>
          {@html viewerSvg}
        </div>
      </div>
    {/if}
  </dialog>
  <figcaption>
    <p>{scene.shortCaption}</p>
    <details class="diagram-sources">
      <summary>{t("Sources et limites du schéma", $language)}</summary>
      <p>{scene.caption}</p>
      <p>{scene.legend}</p>
    </details>
  </figcaption>
</figure>

<style>
  .diagram-viewer[open] { grid-template-rows: auto auto auto auto minmax(44px, 1fr); }
  .mobile-frame-controls { display: flex; gap: var(--st-spacing-2); overflow-x: auto; }
  .mobile-frame-controls :global(button) { flex: 0 0 auto; white-space: nowrap; }
</style>
