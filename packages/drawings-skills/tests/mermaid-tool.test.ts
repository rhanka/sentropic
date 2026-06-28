import { describe, it, expect } from 'vitest';
import { mermaidTool } from '../src/catalog/mermaid/tool';
import { toFunctionToolDefinition } from '../src/catalog/tool-wire';

describe('mermaidTool', () => {
  it('is a local tool named render_mermaid requiring source', () => {
    expect(mermaidTool.name).toBe('render_mermaid');
    expect(mermaidTool.execution).toBe('local');
    expect(mermaidTool.parameters.required).toContain('source');
    const props = mermaidTool.parameters.properties as Record<string, { type: string }>;
    expect(props.source?.type).toBe('string');
  });

  it('toFunctionToolDefinition keeps parameters and strips the app-only execution field', () => {
    const def = toFunctionToolDefinition(mermaidTool);
    expect(def).toEqual({
      name: 'render_mermaid',
      description: mermaidTool.description,
      parameters: mermaidTool.parameters,
    });
    expect('execution' in def).toBe(false);
  });
});
