import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkQualificationRuntime } from '../runtime.mjs';
import { IMAGE_GUARD_COMPARISON } from '../build-inputs.mjs';

describe('qualification runtime', () => {
  it('selects the co-frozen digest in every memory qualification recipe', () => {
    const make = readFileSync('Makefile', 'utf8');
    const freeze = JSON.parse(readFileSync('spec/evidence/memory-mcp-l5/l0-freeze.json'));
    expect(make.includes(`MEMORY_L5_NODE_IMAGE := ${freeze.imageDigest}`)).toBe(true);
    const recipes = make.slice(make.indexOf('.PHONY: memory-l5-lint'), make.indexOf('.PHONY: smoke-mcp-broker-github'));
    // No floating image may EXECUTE here; the only permitted mention is the
    // effective-image guard, which refuses anything but the frozen pin.
    for (const line of recipes.split('\n')) {
      if (line.includes('$(LLM_MESH_NODE_IMAGE)')) expect(line).toContain(IMAGE_GUARD_COMPARISON);
    }
    expect(recipes).toContain('memory-l5-runtime');
  });
  it('rejects substituted image, Node version and flag-dependent execution', () => {
    const freeze = JSON.parse(readFileSync('spec/evidence/memory-mcp-l5/l0-freeze.json'));
    const runtime = { imageDigest: freeze.imageDigest, nodeVersion: '24.21.0', execArgv: [], nodeOptions: '' };
    expect(checkQualificationRuntime(runtime, freeze.imageDigest)).toEqual([]);
    for (const changed of [{ imageDigest: 'node:24' }, { nodeVersion: '22.12.0' },
      { execArgv: ['--experimental-sqlite'] }, { nodeOptions: '--experimental-sqlite' }]) {
      expect(checkQualificationRuntime({ ...runtime, ...changed }, freeze.imageDigest).length).toBeGreaterThan(0);
    }
  });
});
