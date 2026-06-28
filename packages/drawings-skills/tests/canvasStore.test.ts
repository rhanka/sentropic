import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { canvasStore, setSource, setFormat, setModel } from '../src/canvas/svelte/canvasStore';

describe('canvasStore', () => {
  it('updates source while preserving the format', () => {
    setModel({ format: 'mermaid', source: 'flowchart TD\n A-->B' });
    setSource('graph TD\n X-->Y');
    expect(get(canvasStore)).toEqual({ format: 'mermaid', source: 'graph TD\n X-->Y' });
  });

  it('updates format while preserving the source', () => {
    setModel({ format: 'mermaid', source: 'keep me' });
    setFormat('plantuml');
    expect(get(canvasStore)).toEqual({ format: 'plantuml', source: 'keep me' });
  });
});
