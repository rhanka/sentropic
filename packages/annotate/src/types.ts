// @sentropic/annotate — host-agnostic contracts. A diagram canvas is one host (via an AnchorResolver);
// a generic DOM app is another. The comment model mirrors the sentropic Comment shape.

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * LOGICAL = one source-derived id (stable across edits/zoom).
 * GROUP   = the set of logical ids a region selection covers (stable; rect/lasso over ≥1 node).
 * GEOMETRIC = free coords (volatile; may drift after edit) — region selection over empty canvas.
 */
export type Anchor =
  | { class: 'logical'; objectId: string; stability: 'stable' }
  | { class: 'group'; objectIds: string[]; stability: 'stable' }
  | { class: 'geometric'; viewBox?: Rect; domPath?: string; stability: 'volatile' }
  | { class: 'arrow'; from: Point; to: Point; stability: 'volatile' } // model-space endpoints (tail → head)
  | { class: 'freeform'; points: Point[]; stability: 'volatile' }; // model-space polyline (the lasso shape)

export type SelectionKind = 'point' | 'rect' | 'lasso';
export interface Selection {
  kind: SelectionKind;
  polygon: Point[]; // screen-space at selection time
  anchor: Anchor;
}

/** Lazy pull-resolvers — nothing expensive is computed until a consumer asks. */
export interface SelectionCapture {
  getObjectId(): string | null;
  getElements(): Array<{ id: string | null; tag: string; classes: string[] }>;
  getScreenshot(): Promise<string | { unsupported: true }>;
  getComponent(): { id: string; name?: string } | null;
}

// ---- annotation port (SPATIAL ONLY — no canonical comment domain here) ------
//
// This package deliberately does NOT define a `Comment` type, a `CommentStore`,
// or a persistence adapter. `@sentropic/comments` owns the canonical comment
// domain (target kinds `canvas`/`artifact`, tenancy, threading, lifecycle, wire
// events); duplicating it here produced two competing models.
//
// The host bridges this port onto `@sentropic/comments`, mapping
// `AnnotationRecord.anchorKey` -> `CommentTarget.sectionKey` and supplying
// `target.kind`. The port stays SYNCHRONOUS and tenant-agnostic on purpose: the
// overlay renders in an anonymous-first surface (a guest visitor has no tenant),
// while the comments package is async and requires a `TenantContext`. Keeping
// that impedance on the host side is what lets this package stay a pure UI
// substrate that any host — diagram, document, kanban, decision dossier — can
// mount.

/** One annotation as the overlay needs it: a stable anchor key plus display text. */
export interface AnnotationRecord {
  id: string;
  /** Encoded anchor (see `anchorKey`), mapped by the host to `sectionKey`. */
  anchorKey: string;
  /** Rendered in the pin/composer. The host supplies it from its own domain. */
  body: string;
  /** Groups annotations sharing an anchor; opaque to this package. */
  threadId?: string;
  /** Marks machine-proposed content so provenance is never laundered in the UI. */
  origin?: 'human' | 'machine';
  resolved?: boolean;
}

export interface NewAnnotation {
  anchorKey: string;
  body: string;
  threadId?: string;
  origin?: 'human' | 'machine';
}

/**
 * The host seam. Default implementation is in-memory (dev/anonymous); a real host
 * implements it over `@sentropic/comments`.
 */
export interface AnnotationPort {
  /** Open (unresolved) annotations for the mounted context. */
  listOpen(): AnnotationRecord[];
  add(input: NewAnnotation): AnnotationRecord;
  /** Notify the overlay that the underlying store changed. */
  subscribe(cb: () => void): () => void;
}

// ---- host adapter ports (the canvas/DOM host implements these) --------------
export interface AnchorResolver {
  /** Map a clicked element/point to a stable anchor (logical preferred). */
  resolveAt(el: Element | null, point: Point): Anchor | null;
  /** Map a screen-space region (rect/lasso bbox) to a geometric anchor (volatile). */
  resolveRegion?(screenRect: Rect): Anchor | null;
  /** Enumerate the host objects whose box intersects a screen-space region (for group selection + live highlight). */
  nodesInRegion?(screenRect: Rect): Array<{ objectId: string; rect: Rect }>;
  /** Screen point → stable model/document coords (e.g. SVG user space), so freeform marks survive pan/zoom/edit. */
  toModel?(screenPoint: Point): Point | null;
  /** Model coords → current screen point (host-window space). Inverse of toModel. */
  fromModel?(modelPoint: Point): Point | null;
  /** Current screen rect for an anchor — used to (re-)place a pin after render/pan/zoom. */
  locate(anchor: Anchor): Rect | null;
}

export type CaptureFn = (region: { rect: Rect; polygon: Point[] }) => Promise<string | { unsupported: true }>;

export interface AnnotateContext {
  /**
   * Opaque host-context identifiers. This package does not interpret them; the
   * host maps them onto its own domain (e.g. `@sentropic/comments`
   * `CommentTarget.kind` / `.id`).
   */
  contextType: string;
  contextId: string;
  host: HTMLElement;
  anchorResolver: AnchorResolver;
  capture?: CaptureFn;
  /** Host seam — see `AnnotationPort`. Replaces the former in-package CommentStore. */
  annotations: AnnotationPort;
}
