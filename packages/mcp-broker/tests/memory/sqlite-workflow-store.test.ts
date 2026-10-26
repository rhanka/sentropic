import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryWorkflowStoreV1 } from '../../src/memory-reference/index.js';
import { workflowInput } from './workflow-fixture.js';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('should persist one principal-scoped reservation and refuse changed binding after reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-workflow-')); dirs.push(dir);
  const path = join(dir, 'workflow.sqlite');
  let store = await SqliteMemoryWorkflowStoreV1.open(path);
  store.putPolicy('admission', 'v1', { retention: 'original' });
  const input = workflowInput();
  const original = store.reserve(input, true);
  expect(store.settings()).toMatchObject({ journalMode: 'wal', synchronous: 2, busyTimeout: 1000 });
  store.close(); store = await SqliteMemoryWorkflowStoreV1.open(path);
  try {
    expect(store.reserve(input, true)).toEqual(original);
    expect(() => store.reserve(input, 'true')).toThrow('UNAUTHORIZED');
    const changed = workflowInput({ target: { kind: 'candidate', candidate_id: 'candidate-2' },
      effective_input: { tool_name: 'engram_memory_request_admission', candidate_id: 'candidate-2', admission_policy_version: 'v1' } });
    expect(() => store.reserve(changed, true)).toThrow('DIGEST_CONFLICT');
    const other = workflowInput({ principal_id: 'another-human' });
    expect(store.reserve(other, true).key).not.toBe(original.key);
    expect(store.read(original.key, false)).toBeUndefined();
  } finally { store.close(); }
});
it('should reject in-memory storage and unsupported runtimes at explicit activation', async () => {
  await expect(SqliteMemoryWorkflowStoreV1.open(':memory:')).rejects.toThrow('STORE_UNAVAILABLE');
  expect(SqliteMemoryWorkflowStoreV1.supportsRuntime('22.12.0', [], '')).toBe(false);
  expect(SqliteMemoryWorkflowStoreV1.supportsRuntime('23.3.0', [], '')).toBe(false);
  expect(SqliteMemoryWorkflowStoreV1.supportsRuntime('22.13.0', [], '')).toBe(true);
  expect(SqliteMemoryWorkflowStoreV1.supportsRuntime('23.4.0', [], '')).toBe(true);
  expect(SqliteMemoryWorkflowStoreV1.supportsRuntime('24.2.0', ['--experimental-sqlite'], '')).toBe(false);
});
