import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactHost } from '../../src/services/artifacts/composition';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let pool: Pool;
let databaseName: string;
let host: ReturnType<typeof createArtifactHost>;
const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'app', credentialId: 'session-a' };

beforeEach(async () => {
  databaseName = `w1b_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await runMigrations(pool);
  await pool.query(`INSERT INTO users (id, role, account_status) VALUES ('alice', 'editor', 'active'), ('bob', 'editor', 'active');
    INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B');
    INSERT INTO workspaces (id, name, tenant_id) VALUES ('workspace-a', 'A', 'tenant-a'), ('workspace-b', 'B', 'tenant-b');
    INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ('tenant-a', 'alice', 'approved'), ('tenant-b', 'alice', 'approved');
    INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ('workspace-a', 'alice', 'editor'), ('workspace-b', 'alice', 'editor');
    INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at)
      VALUES ('session-a', 'alice', 'hash-a', clock_timestamp() + interval '1 hour');`);
  host = createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144,
    async currentIdentity(client, claims) {
      if (claims.clientId !== 'app') return { readable: false, writable: false };
      const result = await client.query(`SELECT id FROM user_sessions WHERE id = $1 AND user_id = $2
        AND expires_at > clock_timestamp() FOR SHARE`, [claims.credentialId, claims.subject]);
      return { readable: result.rowCount === 1, writable: result.rowCount === 1 };
    } });
});

afterEach(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
});
afterAll(() => admin.end());

async function request() { return host.bind(identity, 'workspace-a'); }
const ensureArgs = (key = 'ensure-a') => ({ bindingName: 'report', idempotencyKey: key });
const publishArgs = (artifactId: string, key = 'publish-a') => ({ artifactId, idempotencyKey: key,
  files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>A</h1>' }] });
async function ensured() {
  const bound = await request();
  const response = await bound.http({ method: 'POST', path: '/ensure', body: ensureArgs() });
  expect(response.status).toBe(201);
  return (response.body as { artifactId: string }).artifactId;
}
async function durable() {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM artifacts.artifacts) AS artifacts,
    (SELECT count(*)::int FROM artifacts.releases) AS releases,
    (SELECT count(*)::int FROM artifacts.operation_receipts) AS receipts,
    (SELECT count(*)::int FROM artifacts.artifact_current) AS pointers,
    (SELECT count(*)::int FROM artifacts.blob_ref_holders h JOIN artifacts.releases r ON h.holder = r.id::text) AS refs`);
  return result.rows[0];
}

describe('app artifact host publication', () => {
  it('should use one subject and opaque scope for HTTP and MCP effects', async () => {
    const bound = await request();
    expect(bound.invocation.actorId).toBe('alice');
    expect(bound.invocation.storageScopeId).not.toMatch(/tenant-a|workspace-a/);
    const http = await bound.http({ method: 'POST', path: '/ensure', body: ensureArgs() });
    const mcp = await (await request()).mcp({ tool: 'artifacts_ensure', args: ensureArgs() });
    expect(http.status).toBe(201);
    const artifactId = (http.body as { artifactId: string }).artifactId;
    expect(mcp).toEqual({ status: 201, body: { artifactId, created: true, replayed: true } });
    const published = await bound.mcp({ tool: 'artifacts_publish', args: publishArgs(artifactId) });
    expect(published.status).toBe(201);
    const before = await durable();
    expect(await bound.http({ method: 'POST', path: '/publish', body: publishArgs(artifactId) })).toEqual(published);
    expect(await durable()).toEqual(before);
    expect(before).toMatchObject({ artifacts: 1, releases: 1, receipts: 2, pointers: 1, refs: 1 });
  });

  it('should deny foreign workspace, subject and tenant bindings', async () => {
    await expect(host.bind({ ...identity, tenantId: 'tenant-b' }, 'workspace-a')).rejects.toThrow();
    await expect(host.bind({ ...identity, subject: 'bob' }, 'workspace-a')).rejects.toThrow();
    await expect(host.bind(identity, 'workspace-b')).rejects.toThrow();
    expect(await durable()).toMatchObject({ artifacts: 0, releases: 0, receipts: 0 });
  });

  it('should refuse unselected tools and forged body authority before durable writes', async () => {
    const bound = await request();
    const before = await durable();
    expect((await bound.mcp({ tool: 'artifacts_delete', args: {} })).status).toBe(503);
    expect((await bound.http({ method: 'POST', path: '/ensure', body: { ...ensureArgs(), actorId: 'bob' } })).status).toBe(400);
    expect(await durable()).toEqual(before);
    expect(bound.profile.selectedCapabilities).toEqual(['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get']);
  });

  it('should recheck current membership on a previously bound request and guarded replay', async () => {
    const artifactId = await ensured();
    const bound = await request();
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = 'workspace-a' AND user_id = 'alice'`);
    const before = await durable();
    expect((await bound.mcp({ tool: 'artifacts_ensure', args: ensureArgs() })).status).toBe(403);
    expect((await bound.http({ method: 'POST', path: '/publish', body: publishArgs(artifactId) })).status).toBe(403);
    expect((await bound.mcp({ tool: 'artifacts_list', args: {} })).status).toBe(403);
    expect(await durable()).toEqual(before);
  });

  it('should observe revocation committed while publication waits for an artifact lock', async () => {
    const artifactId = await ensured();
    const bound = await request();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM artifacts.artifacts WHERE id = $1 FOR UPDATE', [artifactId]);
    const before = await durable();
    const pending = bound.http({ method: 'POST', path: '/publish', body: publishArgs(artifactId) });
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rowCount).toBeGreaterThan(0);
      });
      await pool.query(`UPDATE tenant_memberships SET status = 'suspended' WHERE tenant_id = 'tenant-a' AND user_id = 'alice'`);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await pending).status).toBe(403);
    expect(await durable()).toEqual(before);
  });

  it('should roll back a provisional quota charge when the credential expires during a quota wait', async () => {
    const artifactId = await ensured();
    const bound = await request();
    await pool.query(`UPDATE user_sessions SET expires_at = clock_timestamp() + interval '2 seconds' WHERE id = 'session-a'`);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT key FROM control.artifact_host_kv WHERE storage_scope_id = $1 AND key = 'quota/v1' FOR UPDATE`,
      [bound.invocation.storageScopeId]);
    const before = await durable();
    const pending = bound.mcp({ tool: 'artifacts_publish', args: publishArgs(artifactId) });
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%quota/v1%'`)).rowCount).toBeGreaterThan(0);
      });
      await pool.query(`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM expires_at - clock_timestamp())))
        FROM user_sessions WHERE id = 'session-a'`);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await pending).status).toBe(403);
    expect(await durable()).toEqual(before);
    expect((await pool.query(`SELECT value::jsonb->>'usedBytes' AS used FROM control.artifact_host_kv
      WHERE storage_scope_id = $1 AND key = 'quota/v1'`, [bound.invocation.storageScopeId])).rows).toEqual([{ used: '0' }]);
  });

  it('should serialize competing quota reservations without charging replays', async () => {
    const artifactId = await ensured();
    const bound = await request();
    await pool.query(`UPDATE control.artifact_host_kv SET value = '{"maxBytes":10,"usedBytes":0}'
      WHERE storage_scope_id = $1 AND key = 'quota/v1'`, [bound.invocation.storageScopeId]);
    const responses = await Promise.all(['one', 'two'].map(async (key) =>
      (await request()).mcp({ tool: 'artifacts_publish', args: publishArgs(artifactId, key) })));
    expect(responses.map((result) => result.status).sort()).toEqual([201, 409]);
    const winner = responses.findIndex((result) => result.status === 201);
    expect(await bound.http({ method: 'POST', path: '/publish', body: publishArgs(artifactId, ['one', 'two'][winner]) })).toEqual(responses[winner]);
    expect(await durable()).toMatchObject({ artifacts: 1, releases: 1, receipts: 2, pointers: 1 });
    expect((await pool.query(`SELECT value::jsonb->>'usedBytes' AS used FROM control.artifact_host_kv
      WHERE storage_scope_id = $1 AND key = 'quota/v1'`, [bound.invocation.storageScopeId])).rows).toEqual([{ used: '10' }]);
  });

  it('should retain publication A when B becomes current and deny changed-command replay', async () => {
    const artifactId = await ensured();
    const bound = await request();
    const a = await bound.mcp({ tool: 'artifacts_publish', args: publishArgs(artifactId) });
    const argsB = { ...publishArgs(artifactId, 'publish-b'), files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>B</h1>' }] };
    const b = await bound.http({ method: 'POST', path: '/publish', body: argsB });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aId = (a.body as { releaseId: string }).releaseId;
    const bId = (b.body as { releaseId: string }).releaseId;
    expect(bId).not.toBe(aId);
    expect((await pool.query('SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1', [artifactId])).rows).toEqual([{ release_id: bId }]);
    expect((await pool.query('SELECT id FROM artifacts.releases WHERE id = $1', [aId])).rowCount).toBe(1);
    const before = await durable();
    expect((await bound.mcp({ tool: 'artifacts_publish', args: { ...argsB, idempotencyKey: 'publish-a' } })).status).toBe(409);
    expect(await durable()).toEqual(before);
  });

  it('should reauthorize a successful ensure receipt after its operation-key wait', async () => {
    await ensured();
    const bound = await request();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT internal_key FROM artifacts.operation_keys WHERE storage_scope_id = $1 FOR UPDATE',
      [bound.invocation.storageScopeId]);
    const before = await durable();
    const pending = bound.mcp({ tool: 'artifacts_ensure', args: ensureArgs() });
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rowCount).toBeGreaterThan(0);
      });
      await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = 'workspace-a' AND user_id = 'alice'`);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await pending).status).toBe(403);
    expect(await durable()).toEqual(before);
  });

  it('should recheck expiry after receipt insertion waits and roll back every success record', async () => {
    const artifactId = await ensured();
    const bound = await request();
    await pool.query(`CREATE TABLE receipt_gate (id integer PRIMARY KEY); INSERT INTO receipt_gate VALUES (1);
      CREATE FUNCTION wait_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM id FROM receipt_gate WHERE id = 1 FOR UPDATE; RETURN NEW; END $$;
      CREATE TRIGGER wait_receipt BEFORE INSERT ON artifacts.operation_receipts FOR EACH ROW EXECUTE FUNCTION wait_receipt();
      UPDATE user_sessions SET expires_at = clock_timestamp() + interval '2 seconds' WHERE id = 'session-a'`);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM receipt_gate FOR UPDATE');
    const before = await durable();
    const pending = bound.http({ method: 'POST', path: '/publish', body: publishArgs(artifactId) });
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO artifacts.operation_receipts%'`)).rowCount).toBeGreaterThan(0);
      });
      await pool.query(`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM expires_at - clock_timestamp())))
        FROM user_sessions WHERE id = 'session-a'`);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await pending).status).toBe(403);
    expect(await durable()).toEqual(before);
    expect((await pool.query(`SELECT value::jsonb->>'usedBytes' AS used FROM control.artifact_host_kv
      WHERE storage_scope_id = $1 AND key = 'quota/v1'`, [bound.invocation.storageScopeId])).rows).toEqual([{ used: '0' }]);
  });
});
