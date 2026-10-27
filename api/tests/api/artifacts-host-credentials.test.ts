import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactHost } from '../../src/services/artifacts/composition';
import { createArtifactCredentialReader, createCurrentArtifactIdentity, artifactCredential } from '../../src/services/artifacts/credentials';
import { createArtifactTransport } from '../../src/services/artifacts/transport';
import { createArtifactHttpRouter } from '../../src/routes/namespaces/artifacts';
import { createRegistryDispatchRouter } from '../../src/services/mcp/registry-dispatch';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const resource = 'https://app.example/api/v1/mcp';
let pool: Pool;
let connectionEnds: Promise<void>[];
let database: string;
beforeEach(async () => {
  database = `w2b_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  connectionEnds = [];
  pool.on('connect', client => {
    connectionEnds.push(new Promise<void>(resolve => client.once('end', resolve)));
  });
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
  await Promise.all(connectionEnds);
  await admin.query(`DROP DATABASE "${database}"`);
});
afterAll(() => admin.end());

it('should commit one HTTP/MCP effect using the current session and OAuth readers', async () => {
  const host = createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144,
    currentIdentity: createCurrentArtifactIdentity(resource) });
  const transport = createArtifactTransport(host);
  const session = { subject: 'alice', tenantId: 'tenant-a', clientId: 'sentropic-session',
    credentialId: artifactCredential('session', 'session-a') };
  const oauth = { ...session, clientId: 'client-a', credentialId: artifactCredential('oauth', 'token-a') };
  const app = new Hono().route('/api/v1/resources/artifacts', createArtifactHttpRouter({
    transport: async () => transport, identity: async () => ({ identity: session, workspaceId: 'workspace-a' }),
  })).route('/api/v1/mcp', createRegistryDispatchRouter({ transport: async () => transport, enabled: () => true,
    authorize: async () => ({ allowed: true }),
    authenticate: async () => ({ identity: oauth, workspaceId: 'workspace-a', scopes: ['mcp:tools:invoke'] }),
  }));
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ensure = { bindingName: 'shared-report', idempotencyKey: 'same-ensure' };
  const http = await post('/api/v1/resources/artifacts/ensure', ensure);
  expect(http.status).toBe(201);
  const { artifactId } = await http.json();
  const call = async (name: string, args: unknown) => {
    const response = await post('/api/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const body = await response.json();
    expect(body.result.isError).toBe(false);
    return JSON.parse(body.result.content[0].text);
  };
  expect(await call('artifacts_ensure', ensure)).toMatchObject({ artifactId, replayed: true });
  const publish = { artifactId, idempotencyKey: 'same-publish',
    files: [{ path: 'index.html', mimeType: 'text/html', text: 'A' }] };
  const published = await call('artifacts_publish', publish);
  const replay = await post('/api/v1/resources/artifacts/publish', publish);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(published);
  expect((await pool.query(`SELECT (SELECT count(*)::int FROM artifacts.artifacts) AS artifacts,
    (SELECT count(*)::int FROM artifacts.releases) AS releases,
    (SELECT count(*)::int FROM artifacts.operation_receipts) AS receipts`)).rows)
    .toEqual([{ artifacts: 1, releases: 1, receipts: 2 }]);
});

describe.each(['session', 'oauth'] as const)('current artifact %s credential', (kind) => {
  const identity = () => ({ subject: 'alice', tenantId: 'tenant-a',
    clientId: kind === 'session' ? 'sentropic-session' : 'client-a',
    credentialId: kind === 'session' ? 'session-a' : 'token-a' });
  const reader = (jkt: string | null = null) => createArtifactCredentialReader({ kind, resource, jkt });
  async function authority(overrides = {}, jkt: string | null = null) {
    return reader(jkt)({ query: async (sql, params) => {
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
    it('should require the verified proof key for a DPoP-bound access token', async () => {
      await pool.query(`UPDATE oauth_tokens SET dpop_jkt = 'proof-a';
        UPDATE oauth_clients SET dpop_bound_access_tokens = true`);
      expect(await authority({}, 'proof-a')).toEqual({ readable: true, writable: true });
      expect(await authority({}, 'proof-b')).toEqual({ readable: false, writable: false });
      expect(await authority()).toEqual({ readable: false, writable: false });
    });
    it.each([
      `UPDATE oauth_tokens SET token_type = 'id_token'`,
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
  it('should observe credential revocation committed during the artifact-row wait', async () => {
    const host = createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144, currentIdentity: reader() });
    const bound = await host.bind(identity(), 'workspace-a');
    const ensured = await bound.http({ method: 'POST', path: '/ensure', body: { bindingName: 'report', idempotencyKey: 'ensure' } });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM artifacts.artifacts WHERE id = $1 FOR UPDATE', [artifactId]);
    const pending = bound.mcp({ tool: 'artifacts_publish', args: { artifactId, idempotencyKey: 'publish',
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'A' }] } });
    try {
      await vi.waitFor(async () => expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rowCount).toBeGreaterThan(0));
      await pool.query(kind === 'session' ? 'DELETE FROM user_sessions'
        : `INSERT INTO revoked_tokens (jti, expires_at) VALUES ('token-a', clock_timestamp() + interval '1 hour')`);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    expect((await pending).status).toBe(403);
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.releases')).rows).toEqual([{ n: 0 }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.operation_receipts')).rows).toEqual([{ n: 1 }]);
  });
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
