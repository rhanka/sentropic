import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryWorkflowStoreV1 } from '../../src/memory-reference/index.js';
import { workflowInput, confirmationFixture } from './workflow-fixture.js';
it('should persist bound affirmative confirmation and refuse stale or substituted continuations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-confirm-')), path = join(dir, 'workflow.sqlite');
  let store = await SqliteMemoryWorkflowStoreV1.open(path);
  try {
    const input = workflowInput({ tool_name: 'engram_memory_withdraw', effective_input: {
      tool_name: 'engram_memory_withdraw', candidate_id: 'candidate-1', reason_ref: 'reason-1', event_id: 'event-1',
      event_anchor: { occurred_at: '2026-10-26T00:00:00.000Z', kind_ref: 'withdraw', provenance_ref: 'prov-1', provenance_digest: 'sha256:' + 'a'.repeat(64) },
    } });
    input.policyVersions = { tool_name: 'engram_memory_withdraw' } as never;
    const row = store.reserve(input, true), { continuation, expected } = confirmationFixture(input.preimage, input.digest);
    for (const approved of [false, undefined, null, 'true', 1]) {
      expect(() => store.confirm(row.key, { ...continuation, approved } as never, expected)).toThrow('gate_failed');
    }
    expect(() => store.confirm(row.key, { ...continuation, expires_at: '2026-10-26T00:05:01.000Z' }, expected)).toThrow('gate_failed');
    store.confirm(row.key, continuation, expected);
    store.close(); store = await SqliteMemoryWorkflowStoreV1.open(path);
    expect(store.read(row.key, true)?.confirmation).toEqual(continuation);
    expect(() => store.claim(row.key, 'worker', 1000, 31000, true, expected)).toThrow('gate_failed');
    expect(() => store.claim(row.key, 'worker', Date.parse('2026-10-26T00:05:00.000Z'), 1, true, expected)).toThrow('gate_failed');
    expect(() => store.confirm(row.key, continuation, { ...expected, logical_session_ref: 'new-session' })).toThrow('gate_failed');
    expect(() => store.confirm(row.key, continuation, { ...expected, caller_currently_authorized: false })).toThrow('gate_failed');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
