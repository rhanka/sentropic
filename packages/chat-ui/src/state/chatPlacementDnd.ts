/**
 * chatPlacementDnd — web drag-n-drop GESTURE + hit-testing adapter (SPEC_EVOL_CHAT_SURFACES, L2).
 *
 * Pure geometry + gesture bookkeeping: no DOM, no Svelte, no timers. Given pointer
 * coordinates and host-provided drop-zone rectangles, computes which placement is
 * hovered (with a hit tolerance) and, on drop, the target placement to hand to the
 * placement controller's `requestPlacement` (see ./chatPlacement.ts). This module
 * owns no placement STATE — it only tracks the last hover result within one session.
 *
 * The design system owns the visual DropZone; this is the host-side hit-testing.
 */

import { placementId, type ChatPlacement } from './chatPlacement.js';

export type Rect = { x: number; y: number; width: number; height: number };

export type DropZone = { placement: ChatPlacement; rect: Rect };

export type Viewport = { width: number; height: number };

export type CreateViewportDropZonesOptions = {
  viewport: Viewport;
  supported: ChatPlacement[];
};

export type DragSessionConfig = {
  zones: DropZone[];
  /** Expands every zone's rect by this many px on each side before hit-testing. Default 8. */
  hitTolerancePx?: number;
};

export type DragSession = {
  /** Hovered zone's placement (smallest-area zone wins on overlap), or null outside all. */
  hover(pointerX: number, pointerY: number): ChatPlacement | null;
  /** The last hovered placement at drop, or null if the pointer was outside all zones. */
  end(): ChatPlacement | null;
  /** The configured zones (original, non-expanded rects). */
  zones(): DropZone[];
};

const DEFAULT_HIT_TOLERANCE_PX = 8;

const expandRect = (rect: Rect, tolerancePx: number): Rect => ({
  x: rect.x - tolerancePx,
  y: rect.y - tolerancePx,
  width: rect.width + tolerancePx * 2,
  height: rect.height + tolerancePx * 2,
});

const containsPoint = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const area = (rect: Rect): number => rect.width * rect.height;

/** Fractions of the viewport that define the gesture grammar. */
const EDGE_BAND_WIDTH = 0.15; // side bands that dock the chat as a panel
const EDGE_BAND_HEIGHT = 0.75; // …deliberately NOT full height: see below
const FULL_BAND_HEIGHT = 0.2; // top-middle band that maximises the chat

/**
 * Partition the viewport into placement destinations. A host passes only its
 * supported placements, so the gesture cannot advertise an unreachable drop.
 *
 * The grammar is meant to read as physical intent rather than as a lookup:
 * - dragging to a SIDE EDGE docks the chat as a panel on that side;
 * - dragging to the TOP MIDDLE maximises it;
 * - anywhere else the chat floats, in the column the pointer is over.
 *
 * The side bands stop at 75% of the height on purpose: it is what lets a
 * docked panel be DETACHED by dragging straight down out of its own band and
 * into the floating strip, which is the natural inverse of docking it.
 *
 * A placement may own more than one rect (the floating columns cover both the
 * central block and the bottom strip); every point of the viewport belongs to
 * exactly one placement, so releasing the pointer is never ambiguous.
 */
export function createViewportDropZones(
  opts: CreateViewportDropZonesOptions,
): DropZone[] {
  const { width, height } = opts.viewport;
  const edgeW = width * EDGE_BAND_WIDTH;
  const edgeH = height * EDGE_BAND_HEIGHT;
  const fullH = height * FULL_BAND_HEIGHT;
  const midX = edgeW;
  const midW = width - edgeW * 2;
  const thirdW = width / 3;

  // Central block (below the full-screen band, between the edge bands) and the
  // full-width bottom strip both fall through to the floating columns.
  const centralY = fullH;
  const centralH = edgeH - fullH;
  const stripY = edgeH;
  const stripH = height - edgeH;

  const clamp = (from: number, to: number): { x: number; width: number } => ({
    x: Math.max(from, midX),
    width: Math.max(0, Math.min(to, midX + midW) - Math.max(from, midX)),
  });

  const rects: Record<string, Rect[]> = {
    'drawer.left.primary': [{ x: 0, y: 0, width: edgeW, height: edgeH }],
    'drawer.right.primary': [{ x: width - edgeW, y: 0, width: edgeW, height: edgeH }],
    full: [{ x: midX, y: 0, width: midW, height: fullH }],
    'floating.left': [
      { ...clamp(0, thirdW), y: centralY, height: centralH },
      { x: 0, y: stripY, width: thirdW, height: stripH },
    ],
    'floating.center': [
      { ...clamp(thirdW, thirdW * 2), y: centralY, height: centralH },
      { x: thirdW, y: stripY, width: thirdW, height: stripH },
    ],
    'floating.right': [
      { ...clamp(thirdW * 2, width), y: centralY, height: centralH },
      { x: thirdW * 2, y: stripY, width: thirdW, height: stripH },
    ],
  };

  return opts.supported.flatMap((placement) => {
    const placementRects = rects[placementId(placement)] ?? [];
    return placementRects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ placement, rect }));
  });
}

export function createDragSession(config: DragSessionConfig): DragSession {
  const tolerance = config.hitTolerancePx ?? DEFAULT_HIT_TOLERANCE_PX;
  const zones = [...config.zones];
  const expandedZones = zones.map((zone) => ({
    placement: zone.placement,
    rect: expandRect(zone.rect, tolerance),
  }));

  let lastHovered: ChatPlacement | null = null;

  const hover = (pointerX: number, pointerY: number): ChatPlacement | null => {
    let best: { placement: ChatPlacement; area: number } | null = null;
    for (const zone of expandedZones) {
      if (!containsPoint(zone.rect, pointerX, pointerY)) continue;
      const zoneArea = area(zone.rect);
      if (!best || zoneArea < best.area) {
        best = { placement: zone.placement, area: zoneArea };
      }
    }
    lastHovered = best ? best.placement : null;
    return lastHovered;
  };

  const end = (): ChatPlacement | null => lastHovered;

  return { hover, end, zones: () => [...zones] };
}
