<script lang="ts">
  import type { AnnotateContext, AnnotationRecord, Anchor, Point, Rect } from '../types';
  import { topCenter, cornerPin } from '../geometry';
  import { annotateMode } from './annotateMode';

  let { context, boxZClass = 'z-10' }: { context: AnnotateContext; boxZClass?: string } = $props();

  let overlayEl: HTMLDivElement;
  let annotations = $state<AnnotationRecord[]>([]);
  let pins = $state<Array<{ c: AnnotationRecord; x: number; y: number; n: number; arrow?: { a: Point; b: Point }; poly?: Point[]; rings?: Rect[] }>>([]);
  // draft = the in-progress annotation: a primary pin + (rings | arrow | freeform poly), shown while composing.
  let draft = $state<{ x: number; y: number; anchor: Anchor; label: string; rings: Rect[]; arrow?: { a: Point; b: Point }; poly?: Point[] } | null>(null);
  let text = $state('');
  let gesture = $state<{ kind: 'rect' | 'lasso' | 'arrow'; points: Point[] } | null>(null);
  let highlights = $state<Rect[]>([]);

  const hostRect = () => context.host.getBoundingClientRect();
  function toHost(r: Rect): Rect {
    const hb = hostRect();
    return { x: r.x - hb.x, y: r.y - hb.y, width: r.width, height: r.height };
  }
  function toHostP(p: Point): Point {
    const hb = hostRect();
    return { x: p.x - hb.x, y: p.y - hb.y };
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  function downsample(pts: Point[], max = 24): Point[] {
    if (pts.length <= max) return pts;
    const step = (pts.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]!);
  }
  function centroid(pts: Point[]): Point {
    if (!pts.length) return { x: 8, y: 8 };
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }

  // anchorKey encodes the anchor: logical · group · geometric · arrow · freeform.
  // The host maps it onto its own sub-target (e.g. `CommentTarget.sectionKey`).
  function anchorKeyOf(a: Anchor): string {
    if (a.class === 'logical') return a.objectId;
    if (a.class === 'group') return 'grp:' + a.objectIds.join(',');
    if (a.class === 'arrow') return `arr:${round(a.from.x)},${round(a.from.y)},${round(a.to.x)},${round(a.to.y)}`;
    if (a.class === 'freeform') return 'free:' + a.points.map((p) => `${round(p.x)},${round(p.y)}`).join(';');
    const v = a.viewBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return `geo:${v.x},${v.y},${v.width},${v.height}`;
  }
  function anchorOf(c: AnnotationRecord): Anchor {
    if (c.anchorKey.startsWith('grp:')) return { class: 'group', objectIds: c.anchorKey.slice(4).split(',').filter(Boolean), stability: 'stable' };
    if (c.anchorKey.startsWith('arr:')) {
      const [fx = 0, fy = 0, tx = 0, ty = 0] = c.anchorKey.slice(4).split(',').map(Number);
      return { class: 'arrow', from: { x: fx, y: fy }, to: { x: tx, y: ty }, stability: 'volatile' };
    }
    if (c.anchorKey.startsWith('free:')) {
      const points = c.anchorKey.slice(5).split(';').filter(Boolean).map((pair) => {
        const [x = 0, y = 0] = pair.split(',').map(Number);
        return { x, y };
      });
      return { class: 'freeform', points, stability: 'volatile' };
    }
    if (c.anchorKey.startsWith('geo:')) {
      const [x = 0, y = 0, w = 0, h = 0] = c.anchorKey.slice(4).split(',').map(Number);
      return { class: 'geometric', viewBox: { x, y, width: w, height: h }, stability: 'volatile' };
    }
    return { class: 'logical', objectId: c.anchorKey, stability: 'stable' };
  }

  function ringsFor(a: Anchor): Rect[] {
    if (a.class === 'group') {
      return a.objectIds
        .map((id) => context.anchorResolver.locate({ class: 'logical', objectId: id, stability: 'stable' }))
        .filter((r): r is Rect => !!r)
        .map(toHost);
    }
    const r = context.anchorResolver.locate(a);
    return r ? [toHost(r)] : [];
  }
  // Pin for rect/group/region anchors: a corner of the bbox (prefers top-right) clamped to the host,
  // so the shape stays visible instead of vanishing under the pin. See ../geometry.
  function pinCorner(rings: Rect[]): Point {
    const hb = hostRect();
    return cornerPin(rings, { width: hb.width, height: hb.height });
  }
  function arrowScreen(a: Anchor): { a: Point; b: Point } | undefined {
    if (a.class !== 'arrow') return undefined;
    const fa = context.anchorResolver.fromModel?.(a.from);
    const fb = context.anchorResolver.fromModel?.(a.to);
    return fa && fb ? { a: toHostP(fa), b: toHostP(fb) } : undefined;
  }
  function freeformScreen(a: Anchor): Point[] | undefined {
    if (a.class !== 'freeform') return undefined;
    const pts = a.points.map((p) => context.anchorResolver.fromModel?.(p)).filter((p): p is Point => !!p).map(toHostP);
    return pts.length ? pts : undefined;
  }

  function buildPins(list: AnnotationRecord[]) {
    pins = list.map((c, i) => {
      const a = anchorOf(c);
      if (a.class === 'arrow') {
        const seg = arrowScreen(a);
        const tail = seg?.a ?? { x: 8, y: 8 }; // pin at the TAIL (callout); arrowhead stays clean at the target
        return { c, x: tail.x, y: tail.y, n: i + 1, arrow: seg };
      }
      if (a.class === 'freeform') {
        const poly = freeformScreen(a);
        const p = poly ? centroid(poly) : { x: 8, y: 8 };
        return { c, x: p.x, y: p.y, n: i + 1, poly };
      }
      const rings = ringsFor(a);
      // logical = a single node click → top-center pin, no persistent ring (keeps node comments clean).
      // rect/group/geometric = a region → corner pin + the rings persist so the shape stays visible.
      if (a.class === 'logical') {
        const p = topCenter(rings);
        return { c, x: p.x, y: p.y, n: i + 1 };
      }
      const p = pinCorner(rings);
      return { c, x: p.x, y: p.y, n: i + 1, rings };
    });
  }
  function refresh() {
    const list = context.annotations.listOpen();
    annotations = list;
    buildPins(list);
  }

  function nodeAt(clientX: number, clientY: number): { anchor: Anchor; label: string } | null {
    const target = document.elementsFromPoint(clientX, clientY).find((e) => e !== overlayEl && context.host.contains(e)) ?? null;
    const anchor = context.anchorResolver.resolveAt(target, { x: clientX, y: clientY });
    return anchor && anchor.class === 'logical' ? { anchor, label: anchor.objectId } : null;
  }

  // ---- gesture ----
  let active = false;
  let sx = 0;
  let sy = 0;
  let dragging = false;
  let gestureKind: 'rect' | 'lasso' | 'arrow' = 'lasso';

  const gestureAllowed = (e: PointerEvent) => e.ctrlKey || $annotateMode.active;
  function gestureRect(): Rect {
    const pts = gesture?.points ?? [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  function onDown(e: PointerEvent) {
    if (!gestureAllowed(e)) return;
    if (draft) return;
    e.preventDefault();
    active = true;
    sx = e.clientX;
    sy = e.clientY;
    dragging = false;
    gestureKind = e.shiftKey
      ? 'rect'
      : !e.ctrlKey && $annotateMode.tool === 'rect'
        ? 'rect'
        : !e.ctrlKey && $annotateMode.tool === 'arrow'
          ? 'arrow'
          : 'lasso';
    gesture = null;
    overlayEl.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (draft) return;
    if (!active) {
      if (e.ctrlKey || $annotateMode.active) {
        const found = nodeAt(e.clientX, e.clientY);
        const r = found ? context.anchorResolver.locate(found.anchor) : null;
        highlights = r ? [toHost(r)] : [];
      } else highlights = [];
      return;
    }
    if (!dragging && Math.hypot(e.clientX - sx, e.clientY - sy) > 4) {
      dragging = true;
      gesture = { kind: gestureKind, points: [{ x: sx, y: sy }] };
    }
    if (dragging && gesture) {
      const twoPoint = gesture.kind === 'rect' || gesture.kind === 'arrow';
      const pts = twoPoint ? [{ x: sx, y: sy }, { x: e.clientX, y: e.clientY }] : [...gesture.points, { x: e.clientX, y: e.clientY }];
      gesture = { ...gesture, points: pts };
      if (gesture.kind === 'arrow') {
        const found = nodeAt(e.clientX, e.clientY);
        const r = found ? context.anchorResolver.locate(found.anchor) : null;
        highlights = r ? [toHost(r)] : [];
      } else if (gesture.kind === 'rect') {
        const inside = context.anchorResolver.nodesInRegion?.(gestureRect()) ?? [];
        highlights = inside.map((n) => toHost(n.rect));
      } else {
        highlights = []; // freeform: the yellow trace is the feedback
      }
    }
  }
  function onUp(e: PointerEvent) {
    if (!active) return;
    active = false;
    if (!dragging) {
      const found = nodeAt(e.clientX, e.clientY);
      if (found) {
        const rings = ringsFor(found.anchor);
        draft = { x: topCenter(rings).x, y: topCenter(rings).y, anchor: found.anchor, label: found.label, rings };
        highlights = rings;
      } else {
        draft = null;
        highlights = [];
      }
    } else if (gesture && gesture.kind === 'arrow') {
      const start = gesture.points[0] ?? { x: sx, y: sy };
      const end = gesture.points[gesture.points.length - 1] ?? { x: e.clientX, y: e.clientY };
      const from = context.anchorResolver.toModel?.(start) ?? null;
      const to = context.anchorResolver.toModel?.(end) ?? null;
      const anchor: Anchor = from && to ? { class: 'arrow', from, to, stability: 'volatile' } : { class: 'geometric', stability: 'volatile' };
      const tail = toHostP(start);
      const head = toHostP(end);
      draft = { x: tail.x, y: tail.y, anchor, label: 'arrow', rings: [], arrow: { a: tail, b: head } }; // pin at tail
      highlights = [];
    } else if (gesture && gesture.kind === 'lasso') {
      const screen = gesture.points;
      const model = downsample(screen).map((p) => context.anchorResolver.toModel?.(p)).filter((p): p is Point => !!p);
      const anchor: Anchor = model.length >= 2 ? { class: 'freeform', points: model, stability: 'volatile' } : { class: 'geometric', stability: 'volatile' };
      const poly = screen.map(toHostP);
      const c0 = centroid(poly);
      draft = { x: c0.x, y: c0.y, anchor, label: 'freeform', rings: [], poly };
      highlights = [];
    } else {
      const rect = gestureRect();
      const inside = context.anchorResolver.nodesInRegion?.(rect) ?? [];
      let anchor: Anchor;
      let label: string;
      let rings: Rect[];
      if (inside.length) {
        anchor = { class: 'group', objectIds: inside.map((n) => n.objectId), stability: 'stable' };
        label = inside.length === 1 ? inside[0]!.objectId : `${inside.length} nodes`;
        rings = inside.map((n) => toHost(n.rect));
      } else {
        anchor = context.anchorResolver.resolveRegion?.(rect) ?? { class: 'geometric', stability: 'volatile' };
        label = 'region';
        rings = [toHost(rect)];
      }
      const corner = pinCorner(rings);
      draft = { x: corner.x, y: corner.y, anchor, label, rings };
      highlights = rings;
    }
    gesture = null;
    dragging = false;
    text = '';
  }

  function cancel() {
    draft = null;
    highlights = [];
    text = '';
  }
  function submit() {
    if (!draft || !text.trim()) return;
    context.annotations.add({
      anchorKey: anchorKeyOf(draft.anchor),
      content: text.trim(),
      origin: 'human',
    });
    cancel();
    refresh();
  }

  // Composer box: edge-flip + clamp to the host bounds so it never overflows or covers the shape badly.
  const BW = 248;
  const BH = 132;
  function boxPos(): Point {
    if (!draft) return { x: 0, y: 0 };
    const hb = hostRect();
    let x = draft.x + 14;
    if (x + BW > hb.width) x = draft.x - BW - 14;
    x = Math.max(6, Math.min(x, hb.width - BW - 6));
    let y = draft.y + 14;
    if (y + BH > hb.height) y = draft.y - BH - 14;
    y = Math.max(6, Math.min(y, hb.height - BH - 6));
    return { x, y };
  }

  $effect(() => {
    refresh();
    const unsub = context.annotations.subscribe(() => refresh());
    const ro = new ResizeObserver(() => buildPins(annotations));
    ro.observe(context.host);
    const noCtx = (e: Event) => {
      if ((e as MouseEvent).ctrlKey) e.preventDefault();
    };
    context.host.addEventListener('contextmenu', noCtx);
    return () => {
      unsub();
      ro.disconnect();
      context.host.removeEventListener('contextmenu', noCtx);
    };
  });

  let armed = $derived($annotateMode.active);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={overlayEl}
  class="absolute inset-0 {armed ? 'cursor-crosshair' : ''}"
  style="pointer-events:auto"
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointerleave={() => { if (!draft && !active) highlights = []; }}
>
  <!-- persistent rings for saved region/group annotations — so a rectangle stays visible instead of collapsing to a point -->
  {#each pins as p (p.c.id)}
    {#if p.rings}
      {#each p.rings as r, ri (ri)}
        <div class="annot-ring annot-ring--saved" style="left:{r.x}px; top:{r.y}px; width:{r.width}px; height:{r.height}px"></div>
      {/each}
    {/if}
  {/each}

  {#each highlights as h}
    <div class="annot-ring annot-ring--active" style="left:{h.x}px; top:{h.y}px; width:{h.width}px; height:{h.height}px"></div>
  {/each}

  <!-- arrows + freeform polylines (saved + draft + live) -->
  <svg class="annot-svg pointer-events-none absolute inset-0 h-full w-full overflow-visible">
    <defs>
      <marker id="annot-arrowhead" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L7,3 L0,6 Z" class="annot-stroke-fill" />
      </marker>
    </defs>
    {#each pins as p (p.c.id)}
      {#if p.arrow}
        <line class="annot-stroke" x1={p.arrow.a.x} y1={p.arrow.a.y} x2={p.arrow.b.x} y2={p.arrow.b.y} stroke-width="2.5" stroke-linecap="round" marker-end="url(#annot-arrowhead)" />
      {/if}
      {#if p.poly && p.poly.length > 1}
        <polyline class="annot-stroke" points={p.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      {/if}
    {/each}
    {#if draft?.arrow}
      <line class="annot-stroke" x1={draft.arrow.a.x} y1={draft.arrow.a.y} x2={draft.arrow.b.x} y2={draft.arrow.b.y} stroke-width="2.5" stroke-linecap="round" marker-end="url(#annot-arrowhead)" />
    {/if}
    {#if draft?.poly && draft.poly.length > 1}
      <polyline class="annot-stroke" points={draft.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    {/if}
    {#if gesture}
      {@const hb = hostRect()}
      {#if gesture.kind === 'arrow' && gesture.points.length === 2}
        {@const a = gesture.points[0] ?? { x: 0, y: 0 }}{@const b = gesture.points[1] ?? { x: 0, y: 0 }}
        <line class="annot-stroke" x1={a.x - hb.x} y1={a.y - hb.y} x2={b.x - hb.x} y2={b.y - hb.y} stroke-width="2.5" stroke-linecap="round" marker-end="url(#annot-arrowhead)" />
      {:else if gesture.kind === 'lasso'}
        <polyline class="annot-stroke" points={gesture.points.map((p) => `${p.x - hb.x},${p.y - hb.y}`).join(' ')} fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      {/if}
    {/if}
  </svg>

  {#if gesture && gesture.kind === 'rect' && gesture.points.length === 2}
    {@const hb = hostRect()}
    {@const a = gesture.points[0] ?? { x: 0, y: 0 }}{@const b = gesture.points[1] ?? { x: 0, y: 0 }}
    <div class="annot-rect-gesture pointer-events-none absolute" style="left:{Math.min(a.x, b.x) - hb.x}px; top:{Math.min(a.y, b.y) - hb.y}px; width:{Math.abs(b.x - a.x)}px; height:{Math.abs(b.y - a.y)}px"></div>
  {/if}

  {#each pins as p (p.c.id)}
    <div class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style="left:{p.x}px; top:{p.y}px" title={p.c.body}>
      <span class="annot-pin flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold">
        {#if pins.length > 1}{p.n}{/if}
      </span>
    </div>
  {/each}

  {#if draft}
    <div class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style="left:{draft.x}px; top:{draft.y}px">
      <span class="annot-pin annot-pin--draft block h-5 w-5 rounded-full animate-pulse"></span>
    </div>
    {@const bp = boxPos()}
    <div class="annot-composer absolute {boxZClass} w-60 p-2" role="dialog" aria-label="Annotate {draft.label}" style="left:{bp.x}px; top:{bp.y}px">
      <div class="annot-composer__label mb-1 truncate text-[11px]">Annotate: <span class="font-mono">{draft.label}</span></div>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea bind:value={text} rows="2" autofocus class="annot-composer__input w-full p-1 text-xs" placeholder="Comment for the AI…"></textarea>
      <div class="mt-1 flex justify-end gap-1">
        <button class="annot-btn annot-btn--ghost px-2 py-0.5 text-xs" onclick={cancel}>Cancel</button>
        <button class="annot-btn annot-btn--primary px-2 py-0.5 text-xs" onclick={submit}>Add</button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* WP3 — annotation surfaces restyled to design-system tokens (no hex/rgba literals; logic untouched).
     Blue = --st-color-blue-60 (brand) for pins/rings/highlights; amber = --st-color-feedback-warning for
     the gesture trace/arrows; surface/border/text = slate-0/border/slate-* tokens. color-mix supplies the
     translucent ring fills. Fallbacks keep the module usable when the theme vars are absent. */
  .annot-ring {
    position: absolute;
    pointer-events: none;
    border-radius: 2px;
  }
  .annot-ring--saved {
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-color-blue-60, #3b82f6) 45%, transparent);
  }
  .annot-ring--active {
    transition: all 150ms ease;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-color-blue-60, #3b82f6) 65%, transparent);
  }
  .annot-svg .annot-stroke {
    stroke: var(--st-color-feedback-warning, #d97706);
  }
  .annot-svg .annot-stroke-fill {
    fill: var(--st-color-feedback-warning, #d97706);
  }
  .annot-rect-gesture {
    border: 2px solid var(--st-color-feedback-warning, #d97706);
    background: color-mix(in srgb, var(--st-color-feedback-warning, #d97706) 18%, transparent);
  }
  .annot-pin {
    background: var(--st-color-blue-60, #3b82f6);
    color: var(--st-color-slate-0, #ffffff);
    /* 2px slate-0 halo replaces the former Tailwind ring-2 ring-white. */
    box-shadow:
      0 0 0 2px var(--st-color-slate-0, #ffffff),
      0 1px 2px rgb(0 0 0 / 0.18);
  }
  .annot-pin--draft {
    box-shadow:
      0 0 0 2px var(--st-color-slate-0, #ffffff),
      0 1px 2px rgb(0 0 0 / 0.18);
  }
  .annot-composer {
    background: var(--st-color-slate-0, #ffffff);
    border: 1px solid var(--st-border, var(--st-color-slate-20, #e2e8f0));
    border-radius: 0.5rem;
    box-shadow: 0 12px 28px rgb(15 23 42 / 0.18);
  }
  .annot-composer__label {
    color: var(--st-color-slate-60, #64748b);
  }
  .annot-composer__input {
    border: 1px solid var(--st-border, var(--st-color-slate-20, #e2e8f0));
    border-radius: 0.375rem;
    color: var(--st-color-slate-90, #0f172a);
    background: var(--st-color-slate-0, #ffffff);
  }
  .annot-composer__input:focus-visible {
    outline: 2px solid var(--st-color-blue-60, #3b82f6);
    outline-offset: 1px;
  }
  .annot-btn {
    border-radius: 0.375rem;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .annot-btn--ghost {
    color: var(--st-color-slate-60, #64748b);
    background: transparent;
  }
  .annot-btn--ghost:hover {
    background: var(--st-color-slate-10, #f1f5f9);
  }
  .annot-btn--primary {
    background: var(--st-color-blue-60, #3b82f6);
    color: var(--st-color-slate-0, #ffffff);
  }
  .annot-btn--primary:hover {
    filter: brightness(0.95);
  }
</style>
