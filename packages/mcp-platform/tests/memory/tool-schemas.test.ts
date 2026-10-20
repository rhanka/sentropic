import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEMORY_TOOLS } from '../../src/memory/contracts.js';
const oracle = JSON.parse(readFileSync(new URL('../../../../tools/memory-mcp-l5/fixtures/l0/tool-schemas.json', import.meta.url), 'utf8'));

describe('frozen six-tool schema pairs', () => {
  it.each(MEMORY_TOOLS.map(t => [t.name, t]))('retains the evaluated L0 schemas for %s', (name, tool) => {
    expect(tool.inputSchema).toEqual(oracle.schemas[name].inputSchema);
    expect(tool.outputSchema).toEqual(oracle.schemas[name].outputSchema);
    expect((tool.inputSchema as any).required.length).toBeGreaterThan(0);
    expect((tool.outputSchema as any).oneOf.length).toBe(2);
  });
});
