import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactHost } from '../../src/services/artifacts/composition';
import { createArtifactCredentialReader } from '../../src/services/artifacts/credentials';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const resource = 'https://app.example/api/v1/mcp';
let pool: Pool;
let database: string;
beforeEach(async () => {
  database = `w2b_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  await runMigrations(pool);
  await pool.query(`INSERT INTO users (id, role, account_status) VALUES ('alice', 'editor', 'active');
    INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A');
    INSERT INTO workspaces (id, name, tenant_id) VALUES ('workspace-a', 'A', 'tenant-a');
    INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ('tenant-a', 'alice', 'approved');
    INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ('workspace-a', 'alice', 'editor');
    INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at)
      VALUES ('session-a', 'alice', 'hash-a', clock_timestamp() + interval '1 hour');
    INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes)
      VALUES ('client-a', 'client-a', 'MCP', '{}', ARRAY['mcp:tools:invoke']);
    INSERT INTO oauth_consents (user_id, client_id, tenant_id, scopes)
      VALUES ('alice', 'client-a', 'tenant-a', ARRAY['mcp:tools:invoke']);`);
  await pool.query(`INSERT INTO oauth_tokens (jti, token_type, client_id, user_id, tenant_id, scope, audience, expires_at)
    VALUES ('token-a', 'access_token', 'client-a', 'alice', 'tenant-a', 'mcp:tools:invoke', $1,
      clock_timestamp() + interval '1 hour')`, [resource]);
});
afterEach(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
});
afterAll(() => admin.end());

describe.each(['session', 'oauth'] as const)('current artifact %s credential', (kind) => {
  const identity = () => ({ subject: 'alice', tenantId: 'tenant-a',
    clientId: kind === 'session' ? 'sentropic-session' : 'client-a',
    credentialId: kind === 'session' ? 'session-a' : 'token-a' });
  const reader = () => createArtifactCredentialReader({ kind, resource, jkt: null });
  async function authority(overrides = {}) {
    return reader()({ query: async (sql, params) => {
      const result = await pool.query(sql, [...params]);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } }, { ...identity(), ...overrides });
  }
  it('should bind the exact current credential tuple and reject substitutions', async () => {
    expect(await authority()).toEqual({ readable: true, writable: true });
    for (const overrides of [{ subject: 'bob' }, { clientId: 'other' }, { credentialId: 'other' }]) {
      expect(await authority(overrides)).toEqual({ readable: false, writable: false });
    }
  });
  it('should deny an expired or removed credential', async () => {
    const table = kind === 'session' ? 'user_sessions' : 'oauth_tokens';
    await pool.query(`UPDATE ${table} SET expires_at = clock_timestamp() - interval '1 second'`);
    expect(await authority()).toEqual({ readable: false, writable: false });
    await pool.query(`DELETE FROM ${table}`);
    expect(await authority()).toEqual({ readable: false, writable: false });
  });
  if (kind === 'oauth') {
    it.each([
      `UPDATE oauth_tokens SET token_type = 'refresh_token'`,
      `UPDATE oauth_tokens SET tenant_id = 'other'`,
      `UPDATE oauth_tokens SET audience = 'https://other.example/mcp'`,
      `UPDATE oauth_tokens SET scope = 'openid'`,
      `UPDATE oauth_tokens SET dpop_jkt = 'different-proof'`,
      `UPDATE oauth_consents SET scopes = '{}'`,
      `UPDATE oauth_clients SET allowed_scopes = '{}'`,
      `INSERT INTO revoked_tokens (jti, expires_at) VALUES ('token-a', clock_timestamp() + interval '1 hour')`,
    ])('should deny changed OAuth authority: %s', async (sql) => {
      await pool.query(sql);
      expect(await authority()).toEqual({ readable: false, writable: false });
    });
    it('should retain read permission without granting writes when invoke scope is removed', async () => {
      await pool.query(`UPDATE oauth_tokens SET scope = 'mcp:resources:read';
        UPDATE oauth_consents SET scopes = ARRAY['mcp:resources:read'];
        UPDATE oauth_clients SET allowed_scopes = ARRAY['mcp:resources:read'];`);
      expect(await authority()).toEqual({ readable: true, writable: false });
    });
  }
  it('should roll back publication when DB-time expiry passes during the quota wait', async () => {
    const host = createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144, currentIdentity: reader() });
    const bound = await host.bind(identity(), 'workspace-a');
    const ensured = await bound.http({ method: 'POST', path: '/ensure', body: { bindingName: 'report', idempotencyKey: 'ensure' } });
    expect(ensured.status).toBe(201);
    await pool.query(`UPDATE ${kind === 'session' ? 'user_sessions' : 'oauth_tokens'}
      SET expires_at = clock_timestamp() + interval '2 seconds'`);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT key FROM control.artifact_host_kv WHERE storage_scope_id = $1 AND key = 'quota/v1' FOR UPDATE`,
      [bound.invocation.storageScopeId]);
    const pending = bound.mcp({ tool: 'artifacts_publish', args: {
      artifactId: (ensured.body as { artifactId: string }).artifactId, idempotencyKey: 'publish',
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'A' }],
    } });
    try {
      await vi.waitFor(async () => expect((await pool.query(`SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%quota/v1%'`)).rowCount).toBeGreaterThan(0));
      await pool.query(`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM expires_at - clock_timestamp())))
        FROM ${kind === 'session' ? 'user_sessions' : 'oauth_tokens'}`);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    expect((await pending).status).toBe(403);
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.releases')).rows).toEqual([{ n: 0 }]);
    expect((await pool.query(`SELECT value::jsonb->>'usedBytes' AS used FROM control.artifact_host_kv
      WHERE storage_scope_id = $1 AND key = 'quota/v1'`, [bound.invocation.storageScopeId])).rows).toEqual([{ used: '0' }]);
  });
});
