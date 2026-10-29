import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePredecessors } from '../predecessors.mjs';
import { PROOF_CATALOG } from '../receipt.mjs';
it('resolves L0 and preserves all four transferred suites as later 22-suite obligations', () => {
  const result = resolvePredecessors(process.cwd(), PROOF_CATALOG);
  expect(result.resolved).toBe(true);
  expect(result.transferred).toHaveLength(4);
  expect(result.transferred.every(row => row.status.includes('not executed by L5'))).toBe(true);
  expect(resolvePredecessors(process.cwd(), { ...PROOF_CATALOG, pendingPredecessorMappings: [] }).resolved).toBe(false);
});
it('refuses absent and modified transfer evidence rather than treating missing files as waived', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-predecessors-'));
  try {
    expect(resolvePredecessors(root, PROOF_CATALOG).resolved).toBe(false);
    const path = 'spec/evidence/memory-mcp-l5/p3-registry-v9-obligations.md';
    mkdirSync(join(root, 'spec/evidence/memory-mcp-l5'), { recursive: true });
    writeFileSync(join(root, path), readFileSync(path, 'utf8') + '\nchanged\n');
    expect(resolvePredecessors(root, PROOF_CATALOG).resolved).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
