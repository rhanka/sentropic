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

// ---- comments (sentropic Comment shape) -------------------------------------
export type CommentStatus = 'open' | 'resolved';
export type CommentAuthor = 'human' | 'ai';

export interface Comment {
  id: string;
  contextType: string; // e.g. 'diagram' (↔ sentropic Comment.contextType)
  contextId: string;
  sectionKey: string; // = anchor.objectId (logical) or a region key (geometric)
  threadId: string;
  content: string;
  author: CommentAuthor;
  toolCallId?: string | null; // AI-authored marker
  status: CommentStatus;
  createdBy: string; // df_uid (anon) or userId (after auth)
  createdAt: string;
}

export interface CommentQuery {
  contextType?: string;
  contextId?: string;
  status?: CommentStatus;
}

export interface CommentUpdate {
  type: 'comment_update';
  comment: Comment;
}

export interface AddCommentInput {
  contextType: string;
  contextId: string;
  sectionKey: string;
  content: string;
  author: CommentAuthor;
  createdBy: string;
  toolCallId?: string | null;
  threadId?: string;
}

/** The comment seam. Default = in-memory; swap for the (h2a-extracted) sentropic module later. */
export interface CommentStore {
  list(q?: CommentQuery): Comment[];
  add(input: AddCommentInput): Comment;
  reply(threadId: string, content: string, author: CommentAuthor, createdBy: string, toolCallId?: string | null): Comment | null;
  resolve(threadId: string): void;
  subscribe(cb: (e: CommentUpdate) => void): () => void;
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
  contextType: string;
  contextId: string;
  host: HTMLElement;
  anchorResolver: AnchorResolver;
  capture?: CaptureFn;
  comments: CommentStore;
  createdBy: string;
}
