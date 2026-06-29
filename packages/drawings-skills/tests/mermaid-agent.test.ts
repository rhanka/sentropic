import { describe, it, expect } from 'vitest';
import { createMermaidAgent } from '../src/catalog/mermaid/agent';

describe('mermaid agent (generate -> validate -> retry once)', () => {
  it('returns the generated source when valid, with no retry', async () => {
    let calls = 0;
    const agent = createMermaidAgent({
      generate: async () => {
        calls++;
        return 'flowchart TD\n  A-->B';
      },
    });
    const out = await agent.run({ prompt: 'two nodes' });
    expect(out.source).toContain('flowchart');
    expect(calls).toBe(1);
  });

  it('retries once when the first generation is invalid mermaid', async () => {
    let calls = 0;
    const agent = createMermaidAgent({
      generate: async () => {
        calls++;
        return calls === 1 ? 'this is not a diagram' : 'graph TD\n  A-->B';
      },
    });
    const out = await agent.run({ prompt: 'x' });
    expect(calls).toBe(2);
    expect(out.source).toContain('graph');
  });
});
