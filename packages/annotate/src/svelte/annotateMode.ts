import { writable } from 'svelte/store';

export type AnnotateTool = 'point' | 'rect' | 'lasso' | 'arrow';
export interface AnnotateModeState {
  active: boolean;
  tool: AnnotateTool;
}

/** UI state for the annotate-mode toggle (avoids global Ctrl chords). */
export const annotateMode = writable<AnnotateModeState>({ active: false, tool: 'point' });

export const toggleAnnotate = () => annotateMode.update((m) => ({ ...m, active: !m.active }));
export const setTool = (tool: AnnotateTool) => annotateMode.update((m) => ({ ...m, tool, active: true }));
