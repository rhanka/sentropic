// Canvas contracts (framework-agnostic). The Svelte adapter (Lot 2) implements these.
// DrawingFormatId lives here (the lowest layer) so catalog/types can import it without a cycle.

export type DrawingFormatId = 'mermaid' | 'plantuml' | 'drawio' | (string & {});

export interface CanvasModel {
  format: DrawingFormatId;
  source: string;
}

export interface EditorPort {
  getSource(): string;
  setSource(next: string): void;
  /** Subscribe to source changes; returns an unsubscribe fn. */
  onChange(cb: (source: string) => void): () => void;
}

export type RenderResult = { ok: true } | { ok: false; error: string };

export interface RendererPort {
  render(source: string, target: HTMLElement): Promise<RenderResult>;
  exportSvg?(source: string): Promise<string>;
}

/** Interactivity tiers a format declares. `render` is always present. */
export interface CanvasCapabilities {
  render: true;
  annotate?: boolean;
  edit?: boolean;
}

export type AnnotationTargetKind = 'diagram-node' | 'diagram-region';

export interface AnnotationTarget {
  kind: AnnotationTargetKind;
  /** Stable logical ref (source-derived node id, or region key) — NOT a volatile DOM id. */
  ref: string;
  sectionKey?: string;
}

export interface Annotation {
  id: string;
  threadId: string;
  target: AnnotationTarget;
  content: string;
  /** 'ai' iff toolCallId is present (sentropic comment convention). */
  author: 'human' | 'ai';
  toolCallId?: string | null;
  status: 'open' | 'closed';
}

export interface AnnotatePort {
  resolveTargetAt(el: Element): AnnotationTarget | null;
  /** Serialize open threads for injection into the LLM context. */
  getAnnotationsForAI(): string;
}

export interface CanvasAdapter {
  capabilities: CanvasCapabilities;
  editor: EditorPort;
  renderer: RendererPort;
  annotate?: AnnotatePort;
}
