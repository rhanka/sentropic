import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrateCmFixtureDatabase } from '../utils/cm-fresh-database';
import { createPostgresRemoteLiveRows } from '../../src/services/artifacts/live/postgres';
import { createRemoteDrafts } from '../../src/services/artifacts/live/remote-drafts';
import { createRemoteLive } from '../../src/services/artifacts/live/remote-live';

const NAMESPACE = 'artifact-live-remote/v1';
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const database = `remote_rows_${randomUUID().replaceAll('-', '')}`;
const ends: Promise<void>[] = [];
let url: string;
let pool: Pool;

function trackedPool() {
  const next = new Pool({ connectionString: url });
  next.on('connect', client => ends.push(new Promise<void>(resolve => client.once('end', resolve))));
  return next;
}
const stored = async (key: string) => (await pool.query<{ value: string }>(
  'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2', [NAMESPACE, key])).rows;
const scopeKey = () => ({ storageScopeId: `scope-${randomUUID()}`, artifactId: `artifact-${randomUUID()}` });

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${database}"`);
  const target = new URL(process.env.DATABASE_URL!);
  target.pathname = `/${database}`;
  url = target.toString();
  pool = trackedPool();
  await migrateCmFixtureDatabase(pool);
});
afterAll(async () => {
  await pool?.end();
  await Promise.all(ends);
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
});

describe('Postgres remote live rows (real host KV)', () => {
  it('should persist the next value of an update and read it back from a fresh pool', async () => {
    const rows = createPostgresRemoteLiveRows(pool);
    const key = `row-${randomUUID()}`;
    expect(await rows.update<{ n: number }, number>(key, current => ({ next: { n: (current?.n ?? 0) + 1 }, result: 1 }))).toBe(1);
    expect(await rows.read(key)).toEqual({ n: 1 });
    expect(await rows.update<{ n: number }, number>(key, current => ({ next: { n: current!.n + 1 }, result: current!.n }))).toBe(1);
    expect(await stored(key)).toEqual([{ value: JSON.stringify({ n: 2 }) }]);
    const other = trackedPool();
    try { expect(await createPostgresRemoteLiveRows(other).read(key)).toEqual({ n: 2 }); }
    finally { await other.end(); }
  });

  it('should keep the row on a no-op change and roll back a throwing change', async () => {
    const rows = createPostgresRemoteLiveRows(pool);
    const key = `row-${randomUUID()}`;
    await rows.update(key, () => ({ next: { kept: true }, result: undefined }));
    expect(await rows.update<{ kept: boolean }, string>(key, current => ({ result: String(current?.kept) }))).toBe('true');
    await expect(rows.update(key, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await rows.read(key)).toEqual({ kept: true });
    const absent = `row-${randomUUID()}`;
    expect(await rows.update(absent, () => ({ result: 0 }))).toBe(0);
    expect(await stored(absent)).toEqual([]);
  });

  it('should make a sealed draft readable by the reconcile path', async () => {
    const drafts = createRemoteDrafts(createPostgresRemoteLiveRows(pool));
    const key = scopeKey();
    await expect(drafts.drafts.current(key, 1)).rejects.toMatchObject({ reason: 'draft_not_staged' });
    await drafts.seal(key, { generation: 1, revision: 'r1', pages: 0, baseHeadSha: HEAD, treeSha: TREE, deletes: [] });
    const reader = createRemoteDrafts(createPostgresRemoteLiveRows(pool));
    expect(await reader.drafts.current(key, 1)).toEqual({ generation: 1, revision: 'r1', baseHeadSha: HEAD, treeSha: TREE, dirty: false });
  });

  it('should persist the package fences and the session invitation state', async () => {
    const live = createRemoteLive(createPostgresRemoteLiveRows(pool));
    const key = scopeKey();
    const session = { generation: 1, ownerId: 'owner', liveSessionId: 'session-a', leaseEpoch: 1, routeEpoch: 1 };
    await expect(live.fences(key, 1)).rejects.toMatchObject({ reason: 'stale_session' });
    await live.reconciled(key, session);
    await live.invitation(key, 1, { epoch: 3, expiresAt: 42 });
    const reader = createRemoteLive(createPostgresRemoteLiveRows(pool));
    expect(await reader.fences(key, 1)).toEqual({ liveSessionId: 'session-a', leaseEpoch: 1, routeEpoch: 1 });
    expect(await reader.session(key)).toEqual(session);
    expect(await reader.invitations.current(key, 1)).toEqual({ epoch: 3, expiresAt: 42 });
  });
});
