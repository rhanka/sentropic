import { describe, it, expect } from 'vitest';
import { createDrawingRegistry } from '../src/catalog/registry';
import { buildMermaidFormat } from '../src/catalog/mermaid';

describe('catalog + mermaid integration', () => {
  it('registers the mermaid format and exposes tool/skill/agent/capabilities', async () => {
    const registry = createDrawingRegistry();
    registry.register(buildMermaidFormat({ generate: async () => 'graph TD\n  A-->B' }));

    expect(registry.list().map((f) => f.id)).toEqual(['mermaid']);
    expect(registry.getTool('mermaid')?.name).toBe('render_mermaid');
    expect(registry.getTool('mermaid')?.execution).toBe('local');
    expect(registry.getSkill('mermaid')?.name).toBe('mermaid-generation');

    const fmt = registry.get('mermaid')!;
    expect(fmt.capabilities).toEqual({ render: true, annotate: true });
    expect(fmt.fileExtension).toBe('.mmd');

    const out = await fmt.agent.run({ prompt: 'two nodes' });
    expect(out.source).toContain('graph');
  });
});
