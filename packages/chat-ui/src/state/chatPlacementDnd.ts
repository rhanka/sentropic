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

/**
 * Partition the viewport into placement destinations. A host passes only its
 * supported placements, so the gesture cannot advertise an unreachable drop.
 */
export function createViewportDropZones(
  opts: CreateViewportDropZonesOptions,
): DropZone[] {
  const { width, height } = opts.viewport;
  const rects: Record<string, Rect> = {
    'drawer.left.primary': { x: 0, y: 0, width: width * 0.24, height },
    'drawer.right.primary': { x: width * 0.76, y: 0, width: width * 0.24, height },
    'full': { x: width * 0.24, y: 0, width: width * 0.52, height: height * 0.5 },
    'floating.left': { x: 0, y: height * 0.5, width: width / 3, height: height * 0.5 },
    'floating.center': { x: width / 3, y: height * 0.5, width: width / 3, height: height * 0.5 },
    'floating.right': { x: (width * 2) / 3, y: height * 0.5, width: width / 3, height: height * 0.5 },
  };
  return opts.supported.flatMap((placement) => {
    const rect = rects[placementId(placement)];
    return rect ? [{ placement, rect }] : [];
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
