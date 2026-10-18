import { describe, it, expect } from 'vitest';
import { FORBIDDEN_IMPORT_PARTS, isForbiddenImport } from '../receipt.mjs';

describe('L5 import-graph contract and module disposition rules', () => {
  it('accepts public packed contract subpaths and reference entries', () => {
    expect(isForbiddenImport('@sentropic/mcp-platform/memory')).toBe(false);
    expect(isForbiddenImport('@sentropic/mcp-broker/memory')).toBe(false);
    expect(isForbiddenImport('@sentropic/mcp-broker/memory-reference')).toBe(false);
    expect(isForbiddenImport('node:sqlite')).toBe(false);
  });

  it('rejects runtime cluster-mesh source paths and sibling-source aliases', () => {
    expect(isForbiddenImport('packages/cluster-mesh/src/compose/mcp.ts')).toBe(true);
    expect(isForbiddenImport('../../cluster-mesh/src/index.js')).toBe(true);
    expect(isForbiddenImport('file:../mcp-platform')).toBe(true);
    expect(isForbiddenImport('workspace:*')).toBe(true);
    expect(isForbiddenImport('')).toBe(true);
  });

  it('rejects all seven mock/experimental module dispositions and helpers', () => {
    for (const part of FORBIDDEN_IMPORT_PARTS) {
      expect(isForbiddenImport(`@sentropic/mcp-platform/${part}`)).toBe(true);
    }
    expect(isForbiddenImport('packages/mcp-platform/src/mock/oidc.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/experimental/mutation-gate.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/durable.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/elicitation.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/persistence.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/stores.ts')).toBe(true);
    expect(isForbiddenImport('packages/mcp-platform/src/audit.ts')).toBe(true);
  });
});
