import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryWorkflowStoreV1 } from '../../src/memory-reference/index.js';
import { workflowInput } from './workflow-fixture.js';
it('P05.broker.policy-version-persistence: should retain exact historical policy/defaults and refuse missing history or projection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-policy-')), path = join(dir, 'workflow.sqlite');
  let store = await SqliteMemoryWorkflowStoreV1.open(path);
  try {
    store.putPolicy('admission', 'v1', { retention: 'original' });
    const input = workflowInput(), reserved = store.reserve(input, true);
    store.putPolicy('admission', 'v2', { retention: 'changed' });
    store.close(); store = await SqliteMemoryWorkflowStoreV1.open(path);
    expect(store.read(reserved.key, true)?.input).toEqual(input);
    expect(store.policy('admission', 'v1')).toEqual({ retention: 'original' });
    expect(() => store.policy('admission', 'missing')).toThrow('POLICY_UNAVAILABLE');
    expect(() => store.putPolicy('admission', 'v1', { retention: 'rewritten' })).toThrow('POLICY_STALE');
    expect(() => store.reserve({ ...input, policyVersions: {} as never }, true)).toThrow('POLICY_STALE');
    expect(() => store.reserve({ ...input, digest: 'sha256:' + '0'.repeat(64) }, true)).toThrow('INVALID_DIGEST');
    const missing = workflowInput({ idempotency_key: 'another-key-12345', effective_input: {
      tool_name: 'engram_memory_request_admission', candidate_id: 'candidate-1', admission_policy_version: 'missing' } });
    missing.policyVersions.admission_policy_version = 'missing';
    expect(() => store.reserve(missing, true)).toThrow('POLICY_UNAVAILABLE');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
