import { describe, expect, it } from 'vitest';
import { createPostgresBuildJobStore } from '../../../src/services/artifacts/live/postgres';
import type { BuildJobRecord } from '../../../src/services/artifacts/live/build-jobs';

function fakePool() {
  const rows = new Map<string, string>(); const log: string[] = [];
  const query = async (sql: string, values: string[] = []) => {
    log.push(sql.split(' ')[0]);
    if (sql.startsWith('SELECT value')) return { rows: rows.has(values[0] + values[1]) ? [{ value: rows.get(values[0] + values[1]) }] : [] };
    if (sql.startsWith('INSERT')) rows.set(values[0] + values[1], values[2]);
    return { rows: [] };
  };
  return { rows, log, pool: { query, connect: async () => ({ query, release() { log.push('release'); } }) } };
}
const record = { storageScopeId: 's', artifactId: 'a', jobId: 'j', state: 'accepted', token: 't', admittedAt: 1 } as BuildJobRecord;

describe('Postgres build-job ledger', () => {
  it('serializes one record under the advisory and row locks and persists the change', async () => {
    const f = fakePool(); const store = createPostgresBuildJobStore(f.pool as never);
    expect(await store.update('id', current => ({ next: record, result: current }))).toBeUndefined();
    expect(await store.read('id')).toEqual(record);
    expect(f.log).toEqual(['BEGIN', 'SELECT', 'SELECT', 'INSERT', 'COMMIT', 'release', 'SELECT']);
  });
  it('rolls back and writes nothing when the change throws, and skips the write without a next value', async () => {
    const f = fakePool(); const store = createPostgresBuildJobStore(f.pool as never);
    await expect(store.update('id', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await store.update('id', () => ({ result: 1 }))).toBe(1);
    expect(f.rows.size).toBe(0); expect(f.log).toContain('ROLLBACK'); expect(f.log).not.toContain('INSERT');
  });
});
