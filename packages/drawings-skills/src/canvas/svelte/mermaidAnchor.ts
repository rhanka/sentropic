import type { Anchor, AnchorResolver, Rect } from '@sentropic/annotate';

const cssEscape = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

/**
 * Mermaid host adapter for `@sentropic/annotate`.
 * - LOGICAL anchor: the SOURCE-derived node id (`<diagramId>-flowchart-<id>-<n>` → `<id>`),
 *   stable across edits/zoom (the diagram id prefix changes every render — match by the clean id).
 * - GEOMETRIC anchor: a free region in SVG user coordinates (via getScreenCTM), `volatile`.
 * `locate` returns screen-space rects so pins stay correct under pan/zoom.
 */
export function createMermaidAnchorResolver(getHost: () => HTMLElement | null): AnchorResolver {
  const svgEl = (): SVGSVGElement | null => {
    const host = getHost();
    return host ? host.querySelector('svg') : null;
  };
  const map = (svg: SVGSVGElement, x: number, y: number, inverse: boolean): { x: number; y: number } => {
    const m = svg.getScreenCTM();
    if (!m) return { x, y };
    const p = new DOMPoint(x, y).matrixTransform(inverse ? m.inverse() : m);
    return { x: p.x, y: p.y };
  };
  const findNodeEl = (ref: string): Element | null => {
    const host = getHost();
    if (!host) return null;
    return host.querySelector(`[id*="flowchart-${cssEscape(ref)}-"]`) ?? host.querySelector(`g.node[id="${cssEscape(ref)}"]`);
  };

  return {
    resolveAt(el: Element | null): Anchor | null {
      let node: Element | null = el;
      while (node && node.nodeName.toLowerCase() !== 'svg') {
        const id = node.getAttribute?.('id') ?? '';
        const m = /flowchart-(.+?)-\d+$/.exec(id);
        if (m && m[1]) return { class: 'logical', objectId: m[1], stability: 'stable' };
        node = node.parentElement;
      }
      return null;
    },

    resolveRegion(screenRect: Rect): Anchor | null {
      const svg = svgEl();
      if (!svg) return null;
      const a = map(svg, screenRect.x, screenRect.y, true);
      const b = map(svg, screenRect.x + screenRect.width, screenRect.y + screenRect.height, true);
      return {
        class: 'geometric',
        viewBox: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        stability: 'volatile',
      };
    },

    // Every flowchart node whose box overlaps the region (intersection — a node fully inside still counts).
    nodesInRegion(screenRect: Rect) {
      const host = getHost();
      if (!host) return [];
      const s = screenRect;
      const hit = (r: DOMRect) => !(r.right < s.x || r.left > s.x + s.width || r.bottom < s.y || r.top > s.y + s.height);
      const out: Array<{ objectId: string; rect: Rect }> = [];
      const seen = new Set<string>();
      const nodes = host.querySelectorAll('g.node[id], g[id*="flowchart-"]');
      nodes.forEach((el) => {
        const m = /flowchart-(.+?)-\d+$/.exec(el.getAttribute('id') ?? '');
        if (!m || !m[1] || seen.has(m[1])) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || !hit(b)) return;
        seen.add(m[1]);
        out.push({ objectId: m[1], rect: { x: b.x, y: b.y, width: b.width, height: b.height } });
      });
      return out;
    },

    // Screen ↔ SVG user-space, so freeform marks (e.g. arrows) survive pan/zoom/edit.
    toModel(screenPoint) {
      const svg = svgEl();
      return svg ? map(svg, screenPoint.x, screenPoint.y, true) : null;
    },
    fromModel(modelPoint) {
      const svg = svgEl();
      return svg ? map(svg, modelPoint.x, modelPoint.y, false) : null;
    },

    locate(anchor: Anchor): Rect | null {
      if (anchor.class === 'logical') {
        const el = findNodeEl(anchor.objectId);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
      if (anchor.class === 'group' || anchor.class === 'arrow' || anchor.class === 'freeform') return null; // resolved by the caller
      const svg = svgEl();
      const v = anchor.viewBox;
      if (!svg || !v) return null;
      const a = map(svg, v.x, v.y, false);
      const b = map(svg, v.x + v.width, v.y + v.height, false);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    },
  };
}
