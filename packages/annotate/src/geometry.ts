// @sentropic/annotate — pure pin/shape geometry. Host-agnostic: takes screen-space rects and the
// host's pixel size, returns where the numbered pin should sit. Extracted from the Svelte adapter so
// the heuristic is unit-testable and portable into the Sentropic canvas lane.
import type { Point, Rect } from './types';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const SAFE_INSET: Point = { x: 8, y: 8 };

export function bboxOf(rects: Rect[]): Bounds {
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { minX, maxX, minY, maxY };
}

/** Top-center of the bounding box — the pin position for a single logical node anchor. */
export function topCenter(rects: Rect[]): Point {
  if (!rects.length) return { ...SAFE_INSET };
  const b = bboxOf(rects);
  return { x: (b.minX + b.maxX) / 2, y: b.minY };
}

export interface CornerPinOpts {
  /** Outward gap between the bbox corner and the pin center. */
  offset?: number;
  /** Keep-out distance from each host edge so the pin never clips. */
  margin?: number;
}

/**
 * Pin for rectangle / group / region anchors: a corner of the bounding box with a small outward
 * offset, so the shape stays visible instead of collapsing under the pin. Prefer top-right; if that
 * leaves the host viewport, fall back top-left → bottom-right → bottom-left; if none fit, clamp the
 * preferred corner inside the host. `host` is the host's pixel size (CSS px).
 */
export function cornerPin(rects: Rect[], host: { width: number; height: number }, opts: CornerPinOpts = {}): Point {
  if (!rects.length) return { ...SAFE_INSET };
  const offset = opts.offset ?? 6;
  const margin = opts.margin ?? 12;
  const b = bboxOf(rects);
  const candidates: Point[] = [
    { x: b.maxX + offset, y: b.minY - offset }, // top-right (preferred)
    { x: b.minX - offset, y: b.minY - offset }, // top-left
    { x: b.maxX + offset, y: b.maxY + offset }, // bottom-right
    { x: b.minX - offset, y: b.maxY + offset }, // bottom-left
  ];
  const fits = (p: Point) => p.x >= margin && p.x <= host.width - margin && p.y >= margin && p.y <= host.height - margin;
  const c = candidates.find(fits) ?? candidates[0]!;
  return {
    x: Math.max(margin, Math.min(c.x, host.width - margin)),
    y: Math.max(margin, Math.min(c.y, host.height - margin)),
  };
}
