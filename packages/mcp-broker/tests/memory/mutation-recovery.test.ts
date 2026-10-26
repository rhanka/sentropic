import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryWorkflowStoreV1 } from '../../src/memory-reference/index.js';
import { workflowInput } from './workflow-fixture.js';
it('should fence expired workers and reconcile unknown outcomes before any repeat execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-recovery-'));
  const store = await SqliteMemoryWorkflowStoreV1.open(join(dir, 'workflow.sqlite'));
  try {
    const row = store.reserve(workflowInput(), true);
    const first = store.claim(row.key, 'worker-1', 1000, 30000, true);
    expect(() => store.claim(row.key, 'worker-2', 1001, 30000, true)).toThrow('FENCE_LOST');
    expect(() => store.claim(row.key, 'worker-2', 31000, 30000, true)).toThrow('MUTATION_OUTCOME_UNKNOWN');
    expect(() => store.complete(row.key, first.fence, { receipt: 'unproven' })).toThrow('MUTATION_OUTCOME_UNKNOWN');
    store.markUnknown(row.key, first.fence);
    expect(() => store.claim(row.key, 'worker-2', 32000, 30000, true)).toThrow('MUTATION_OUTCOME_UNKNOWN');
    const proof = { status: 'committed' as const, operationDigest: row.input.digest, replayRef: 'canonical-original', result: { receipt: 'original' } };
    store.reconcile(row.key, proof, true);
    expect(store.read(row.key, true)?.canonical).toEqual(proof);
    expect(() => store.claim(row.key, 'worker-2', 33000, 30000, true)).toThrow('ALREADY_TERMINAL');
    expect(store.read(row.key, false)).toBeUndefined();
    expect(() => store.reconcile(row.key, proof, false)).toThrow('UNAUTHORIZED');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
