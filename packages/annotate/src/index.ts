// @sentropic/annotate — the reusable SPATIAL annotation substrate.
//
// Scope: selection (point/rect/lasso/arrow), anchors (logical/geometric/group/
// arrow), geometry, pins and the overlay. It owns NO comment domain: the host
// bridges `AnnotationPort` onto `@sentropic/comments`, which is canonical for
// comments (target kinds `canvas`/`artifact`, tenancy, threading, lifecycle).
//
// The Svelte overlay lives under `./svelte`; a host binds it through an
// `AnchorResolver`, so a diagram is only one possible host.
export * from './types';
export { createInMemoryAnnotationPort, annotationsForAI } from './annotation-port';
export { bboxOf, topCenter, cornerPin } from './geometry';
export type { Bounds, CornerPinOpts } from './geometry';
