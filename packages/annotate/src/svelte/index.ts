// @sentropic/annotate/svelte — the host-agnostic annotation overlay + mode store.
// A host (canvas, generic DOM) provides an AnchorResolver via the AnnotateContext.
export { annotateMode, toggleAnnotate, setTool } from './annotateMode';
export type { AnnotateTool, AnnotateModeState } from './annotateMode';
export { default as AnnotationLayer } from './AnnotationLayer.svelte';
