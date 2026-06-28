import { writable } from 'svelte/store';
import type { CanvasModel, DrawingFormatId } from '../types';

/** Single source of truth for the active diagram: the editor, render pane and chat local-tool all use it. */
export const canvasStore = writable<CanvasModel>({ format: 'mermaid', source: '' });

export function setSource(source: string): void {
  canvasStore.update((s) => ({ ...s, source }));
}

export function setFormat(format: DrawingFormatId): void {
  canvasStore.update((s) => ({ ...s, format }));
}

export function setModel(model: CanvasModel): void {
  canvasStore.set(model);
}
