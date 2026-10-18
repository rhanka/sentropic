import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('qualification runtime', () => {
  it('selects the co-frozen digest in every memory qualification recipe', () => {
    const make = readFileSync('Makefile', 'utf8');
    const freeze = JSON.parse(readFileSync('spec/evidence/memory-mcp-l5/l0-freeze.json'));
    expect(make).toContain(`MEMORY_L5_NODE_IMAGE := ${freeze.imageDigest}`);
    const recipes = make.slice(make.indexOf('.PHONY: memory-l5-lint'), make.indexOf('.PHONY: smoke-mcp-broker-github'));
    expect(recipes).not.toContain('$(LLM_MESH_NODE_IMAGE)');
    expect(recipes).toContain('memory-l5-runtime');
  });
});
