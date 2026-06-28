// Svelte canvas adapter. Annotation is owned by @sentropic/annotate (module-first);
// the canvas provides the mermaid AnchorResolver and re-exports the overlay for convenience.
export { canvasStore, setSource, setFormat, setModel } from './canvasStore';
export { createMermaidAnchorResolver } from './mermaidAnchor';
export { default as EditorPane } from './EditorPane.svelte';
export { default as RenderPane } from './RenderPane.svelte';
export { AnnotationLayer, annotateMode, toggleAnnotate, setTool } from '@sentropic/annotate/svelte';
export { createInMemoryCommentStore, annotationsForAI } from '@sentropic/annotate';
export type { AnnotateContext, Comment, CommentStore } from '@sentropic/annotate';
