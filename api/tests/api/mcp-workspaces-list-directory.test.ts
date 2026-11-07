import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { migrateCmFixtureDatabase } from '../utils/cm-fresh-database';
import { seedCmArtifactIdentity } from '../utils/cm-artifact-fixture';
import { ARTIFACT_AUTHORITY_SOURCE, createArtifactAuthorization } from '../../src/services/artifacts/authorization';
import { artifactCredential, artifactTurnCredential, createCurrentArtifactIdentity } from '../../src/services/artifacts/credentials';
import { createWorkspaceDirectory } from '../../src/services/artifacts/workspace-directory';
import { createRegistryDispatchRouter } from '../../src/services/mcp/registry-dispatch';

// workspaces_list against the real CM authority tables: the filter is exactly
// createArtifactAuthorization.read for the token tenant, and publishable is its writable.

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const resource = 'https://app.example/api/v1/mcp';
const ALL = ['workspace-a', 'ws-viewer', 'ws-commenter', 'ws-admin-1', 'ws-admin-2', 'ws-hidden', 'ws-outsider',
  'ws-unknown-role', 'workspace-foreign'];
const oauth = (scopes: string[]) => ({ subject: 'alice', tenantId: 'tenant-a', clientId: 'client-a',
  credentialId: artifactCredential('oauth', 'token-a', null, scopes) });
let pool: Pool;
let database: string;
let connectionEnds: Promise<void>[];

async function addWorkspace(id: string, name: string, role: string | null, hidden = false) {
  await pool.query('INSERT INTO public.workspaces (id, name, hidden_at) VALUES ($1, $2, $3)', [id, name, hidden ? new Date() : null]);
  await pool.query(`INSERT INTO cm_identity.cm_workspaces (workspace_id, tenant_id, enrolled_at)
    VALUES ($1, 'tenant-a', $2)`, [id, new Date().toISOString()]);
  if (role) await pool.query(`INSERT INTO cm_identity.cm_workspace_members (workspace_id, user_id, role)
    VALUES ($1, 'alice', $2)`, [id, role]);
}

beforeEach(async () => {
  database = `wsl_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  connectionEnds = [];
  pool.on('connect', client => { connectionEnds.push(new Promise<void>(resolve => client.once('end', resolve))); });
  await migrateCmFixtureDatabase(pool);
  // Alice is an approved editor of workspace-a (tenant-a) and of workspace-foreign (tenant-b).
  await seedCmArtifactIdentity(pool, { additionalScopes: [{ workspaceId: 'workspace-foreign', tenantId: 'tenant-b' }] });
  // Inserted out of order: the result order must come from the directory, not the heap.
  await pool.query(`UPDATE public.workspaces SET name = 'beta' WHERE id = 'workspace-a'`);
  await addWorkspace('ws-viewer', 'Ébène', 'viewer');
  await addWorkspace('ws-admin-2', 'Alpha', 'admin');
  await addWorkspace('ws-commenter', 'alpha', 'commenter');
  await addWorkspace('ws-hidden', 'aaa hidden', 'editor', true);
  await addWorkspace('ws-outsider', 'aaa outsider', null);
  await addWorkspace('ws-unknown-role', 'aaa unknown role', 'owner');
  await addWorkspace('ws-admin-1', 'Alpha', 'admin');
  await pool.query(`INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes)
      VALUES ('client-a', 'client-a', 'MCP', '{}', ARRAY['mcp:discover', 'mcp:tools:invoke']);
    INSERT INTO oauth_consents (user_id, client_id, tenant_id, scopes)
      VALUES ('alice', 'client-a', 'tenant-a', ARRAY['mcp:discover', 'mcp:tools:invoke']);`);
  await pool.query(`INSERT INTO oauth_tokens (jti, token_type, client_id, user_id, tenant_id, scope, audience, expires_at)
    VALUES ('token-a', 'access_token', 'client-a', 'alice', 'tenant-a', 'mcp:discover mcp:tools:invoke', $1,
      clock_timestamp() + interval '1 hour')`, [resource]);
  await pool.query(`INSERT INTO cm_identity.cm_oauth_consents (consent_id, tenant_id, user_id, client_id, granted_at)
    VALUES ('consent-a', 'tenant-a', 'alice', 'client-a', $1)`, [new Date().toISOString()]);
});
afterEach(async () => {
  await pool.end();
  await Promise.all(connectionEnds);
  await admin.query(`DROP DATABASE "${database}"`);
});
afterAll(() => admin.end());

async function call(params: Record<string, unknown> = {}) {
  const app = new Hono().route('/api/v1/mcp', createRegistryDispatchRouter({
    transport: async () => { throw new Error('workspaces_list must not bind the artifact transport'); },
    enabled: () => true, authorize: async () => ({ allowed: true }),
    authenticate: vi.fn(async (_context, scopes: string[]) => ({ identity: oauth(scopes), workspaceId: 'workspace-a', scopes })),
    workspaces: createWorkspaceDirectory({ pool, currentIdentity: createCurrentArtifactIdentity(resource) }),
  }));
  const response = await app.request('/api/v1/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'w', method: 'tools/call', params: { name: 'workspaces_list', ...params } }) });
  return { status: response.status, body: await response.json() };
}

describe('workspaces_list directory', () => {
  it('should list exactly the readable workspaces of the token tenant in UTF-16 name then ref order', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.result.isError).toBe(false);
    expect(JSON.parse(body.result.content[0].text)).toStrictEqual({ workspaces: [
      { workspaceRef: 'ws-admin-1', name: 'Alpha', role: 'admin', publishable: true },
      { workspaceRef: 'ws-admin-2', name: 'Alpha', role: 'admin', publishable: true },
      { workspaceRef: 'ws-commenter', name: 'alpha', role: 'commenter', publishable: false },
      { workspaceRef: 'workspace-a', name: 'beta', role: 'editor', publishable: true },
      { workspaceRef: 'ws-viewer', name: 'Ébène', role: 'viewer', publishable: false },
    ] });
    expect(await call({ workspaceRef: 'workspace-foreign' })).toStrictEqual({ status, body });
  });

  it.each([
    `UPDATE cm_identity.identity_account_profiles SET disabled_at = clock_timestamp()`,
    `UPDATE cm_identity.cm_tenant_memberships SET status = 'pending' WHERE tenant_id = 'tenant-a'`,
    `UPDATE cm_identity.identity_user_accounts SET account_status = 'pending_admin_approval'`,
    `UPDATE cm_identity.cm_tenants SET status = 'suspended' WHERE tenant_id = 'tenant-a'`,
  ])('should list no workspace when the shared approval predicate fails: %s', async (sql) => {
    await pool.query(sql);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(JSON.parse(body.result.content[0].text)).toStrictEqual({ workspaces: [] });
  });

  it.each([
    { consent: ['mcp:discover', 'mcp:tools:invoke'], publishable: ['workspace-a', 'ws-admin-1', 'ws-admin-2'] },
    { consent: ['mcp:discover'], publishable: [] },
  ])('should match createArtifactAuthorization.current() for every workspace with consent $consent', async (input) => {
    await pool.query('UPDATE oauth_consents SET scopes = $1', [input.consent]);
    const texts: string[] = [];
    const traced = { query: (sql: string, params: unknown[]) => { texts.push(sql); return pool.query(sql, params); } } as unknown as Pool;
    const currentIdentity = createCurrentArtifactIdentity(resource);
    const identity = oauth([]);
    const directory = await createWorkspaceDirectory({ pool: traced, currentIdentity })(identity);
    const listed = new Map(directory!.workspaces.map(row => [row.workspaceRef, row]));
    for (const workspaceId of ALL) {
      const authority = await createArtifactAuthorization({ identity, workspaceId, storageScopeId: '',
        pool: traced, currentIdentity }).current();
      expect({ workspaceId, listed: listed.has(workspaceId) }).toEqual({ workspaceId, listed: authority.readable });
      if (listed.has(workspaceId)) expect(listed.get(workspaceId)!.publishable).toBe(authority.writable);
    }
    expect([...listed.values()].filter(row => row.publishable).map(row => row.workspaceRef).sort()).toEqual(input.publishable);
    // read() and the directory query the one shared authority source.
    expect(texts.filter(sql => sql.includes(ARTIFACT_AUTHORITY_SOURCE))).toHaveLength(1 + ALL.length);
  });

  it.each([
    `UPDATE cm_identity.cm_oauth_consents SET revoked_at = clock_timestamp()`,
    `INSERT INTO revoked_tokens (jti, expires_at) VALUES ('token-a', clock_timestamp() + interval '1 hour')`,
    `UPDATE oauth_tokens SET expires_at = clock_timestamp() - interval '1 second'`,
  ])('should refuse a credential that is no longer current with access_denied: %s', async (sql) => {
    await pool.query(sql);
    expect(await call()).toEqual({ status: 403,
      body: { jsonrpc: '2.0', id: 'w', error: { code: -32003, message: 'access_denied' } } });
  });

  it('should refuse a workspace-bound chat turn credential', async () => {
    const directory = createWorkspaceDirectory({ pool, currentIdentity: createCurrentArtifactIdentity(resource) });
    expect(await directory({ subject: 'alice', tenantId: 'tenant-a', clientId: 'sentropic-turn',
      credentialId: artifactTurnCredential('turn-a', 'workspace-a') })).toBeNull();
  });
});
