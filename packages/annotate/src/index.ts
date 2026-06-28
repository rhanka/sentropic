// @sentropic/annotate — collaborative annotation/review (host-agnostic core).
// The Svelte canvas adapter (selection tools + pins, zoom/pan aware) is added under ./svelte (P1 UI).
export * from './types';
export { createInMemoryCommentStore, annotationsForAI } from './comment-store';
export { bboxOf, topCenter, cornerPin } from './geometry';
export type { Bounds, CornerPinOpts } from './geometry';
