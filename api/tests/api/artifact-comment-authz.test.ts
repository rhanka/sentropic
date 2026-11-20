import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import type { SharingPolicyContext } from '@sentropic/artifacts/server/access';
import { migrateCmFixtureDatabase } from '../utils/cm-fresh-database';
import { seedCmArtifactIdentity } from '../utils/cm-artifact-fixture';
import { createArtifactHost } from '../../src/services/artifacts/composition';
import { artifactCredential, createCurrentArtifactIdentity } from '../../src/services/artifacts/credentials';
import { createPostgresArtifactCommentAuthz } from '../../src/services/comments/artifact-comment-authz';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const resource = 'https://app.example/api/v1/mcp';
const MISSING_UUID = '99999999-9999-4999-8999-999999999999';
const NOT_FOUND = { ok: false, status: 404, code: 'artifact_not_found' } as const;
const FORBIDDEN = { ok: false, status: 403, code: 'comment_forbidden' } as const;

let pool: Pool;
let database: string;
let connectionEnds: Promise<void>[];

const sessionFor = (userId: string, tenantId = 'tenant-a') => ({
  subject: userId, tenantId, clientId: 'sentropic-session',
  credentialId: artifactCredential('session', `session-${userId}`),
});

async function seedSession(userId: string) {
  const now = new Date().toISOString(), expires = new Date(Date.now() + 3_600_000).toISOString(), sid = `session-${userId}`;
  await pool.query(`INSERT INTO cm_identity.identity_login_sessions (session_id, user_id, status, mfa_state, created_at, expires_at, refresh_count) VALUES ($1, $2, 'active', 'none', $3, $4, 0)`, [sid, userId, now, expires]);
  await pool.query(`INSERT INTO cm_identity.identity_login_token_bindings (session_id, session_token_hash, mfa_verified, auth_time, session_version, rotation_version) VALUES ($1, $2, false, $3, $4, 1)`,
    [sid, createHash('sha256').update(sid).digest('hex'), Math.floor(Date.parse(now) / 1000), Date.parse(now)]);
}

async function seedArtifacts() {
  const currentIdentity = createCurrentArtifactIdentity(resource);
  const host = createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144, currentIdentity });
  const boundA = await host.bind(sessionFor('alice'), 'workspace-a');
  const boundB = await host.bind(sessionFor('alice'), 'workspace-b');
  const ensure = async (bound: typeof boundA, name: string) =>
    ((await bound.mcp({ tool: 'artifacts_ensure', args: { bindingName: name, idempotencyKey: `k-${name}` } })).body as { artifactId: string }).artifactId;
  const [privateId, sharedId, grantId, publicId, deletedId, otherWsId] = await Promise.all([
    ensure(boundA, 'private'), ensure(boundA, 'shared'), ensure(boundA, 'grant'),
    ensure(boundA, 'public'), ensure(boundA, 'deleted'), ensure(boundB, 'other-ws'),
  ]);
  const store = createPostgresArtifactStore(pool);
  const scopeA = (await store.getArtifactAcl(privateId))!.storageScopeId;
  await store.putArtifactAcl(sharedId, { ownerId: 'alice', storageScopeId: scopeA, isPublic: true, withdrawn: false, accessMode: 'platform', grants: [] });
  await store.putArtifactAcl(grantId, { ownerId: 'alice', storageScopeId: scopeA, isPublic: false, withdrawn: false, accessMode: 'restricted', grants: [{ principalId: 'carol', grant: 'read' }] });
  await store.putArtifactAcl(publicId, { ownerId: 'alice', storageScopeId: scopeA, isPublic: true, withdrawn: false, accessMode: 'public', grants: [] });
  await store.setArtifactState(deletedId, 'deleted');
  return { privateId, sharedId, grantId, publicId, deletedId, otherWsId, scopeA, currentIdentity };
}

beforeEach(async () => {
  database = `aca_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  connectionEnds = [];
  pool.on('connect', client => { connectionEnds.push(new Promise<void>(resolve => client.once('end', resolve))); });
  await migrateCmFixtureDatabase(pool);
  await seedCmArtifactIdentity(pool, {
    userId: 'alice',
    otherUsers: ['bob', 'carol', 'dave', 'erin'],
    sessionIds: ['session-alice'],
    additionalScopes: [{ workspaceId: 'workspace-foreign', tenantId: 'tenant-b' }],
  });
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO public.workspaces (id, name) VALUES ('workspace-b', 'B')`);
  await pool.query(`INSERT INTO cm_identity.cm_workspaces (workspace_id, tenant_id, enrolled_at) VALUES ('workspace-b', 'tenant-a', $1)`, [now]);
  await pool.query(`INSERT INTO cm_identity.cm_workspace_members (workspace_id, user_id, role) VALUES ('workspace-b', 'alice', 'editor')`);
  for (const [user, role] of [['bob', 'editor'], ['carol', 'commenter'], ['dave', 'viewer'], ['erin', 'admin']] as const) {
    await pool.query(
      `INSERT INTO cm_identity.cm_tenant_memberships (user_id, tenant_id, status, tenant_role, decided_by, decided_at, updated_at)
       VALUES ($1, 'tenant-a', 'approved', 'member', 'alice', $2, $2)`,
      [user, now],
    );
    await pool.query(`INSERT INTO cm_identity.cm_workspace_members (workspace_id, user_id, role) VALUES ('workspace-a', $1, $2)`, [user, role]);
    await seedSession(user);
  }
});

afterEach(async () => {
  await pool.end();
  await Promise.all(connectionEnds);
  await admin.query(`DROP DATABASE "${database}"`);
});
afterAll(() => admin.end());

describe('createPostgresArtifactCommentAuthz (real PostgreSQL)', () => {
  it('should authorize roles, enforce workspace/tenant isolation, and never query PG on non-UUID ids', async () => {
    const { privateId, sharedId, grantId, deletedId, otherWsId, scopeA, currentIdentity } = await seedArtifacts();
    const sqlLog: string[] = [];
    const traced = { query: (sql: string, params?: unknown[]) => { sqlLog.push(sql); return pool.query(sql, params); } } as unknown as Pool;
    const authz = createPostgresArtifactCommentAuthz({ pool: traced, currentIdentity });
    expect(await authz({ identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: 'not-a-uuid' })).toEqual(NOT_FOUND);
    expect(sqlLog).toEqual([]);
    expect(await authz({ identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: privateId }))
      .toMatchObject({ ok: true, artifactId: privateId, storageScopeId: scopeA, authority: { readable: true, commentable: true, writable: true } });
    expect(await authz({ identity: sessionFor('bob'), workspaceId: 'workspace-a', artifactId: sharedId })).toMatchObject({ ok: true });
    expect(await authz({ identity: sessionFor('carol'), workspaceId: 'workspace-a', artifactId: grantId }))
      .toMatchObject({ ok: true, authority: { readable: true, commentable: true, writable: false } });
    expect(await authz({ identity: sessionFor('erin'), workspaceId: 'workspace-a', artifactId: sharedId })).toMatchObject({ ok: true });
    expect(await authz({ identity: sessionFor('dave'), workspaceId: 'workspace-a', artifactId: sharedId })).toEqual(FORBIDDEN);
    expect(await authz({ identity: sessionFor('dave'), workspaceId: 'workspace-a', artifactId: sharedId, action: 'read' }))
      .toMatchObject({ ok: true, authority: { readable: true, commentable: false, writable: false } });
    for (const req of [
      { identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: MISSING_UUID },
      { identity: sessionFor('dave'), workspaceId: 'workspace-a', artifactId: privateId },
      { identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: deletedId },
      { identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: otherWsId },
      { identity: sessionFor('alice', 'tenant-b'), workspaceId: 'workspace-a', artifactId: privateId },
    ]) {
      expect(await authz(req)).toEqual(NOT_FOUND);
    }
  });

  it('should return 404 when membership is pending or revoked in DB, and fail closed on action/sharingPolicy', async () => {
    const { privateId, publicId, currentIdentity } = await seedArtifacts();
    const closedAuthz = createPostgresArtifactCommentAuthz({ pool, currentIdentity });
    const throwingAuthz = createPostgresArtifactCommentAuthz({ pool, currentIdentity, sharingPolicy: () => { throw new Error('boom'); } });
    const malformedAuthz = createPostgresArtifactCommentAuthz({ pool, currentIdentity, sharingPolicy: () => ({ allowPublicSharing: 'yes' } as unknown as SharingPolicyContext) });
    const openAuthz = createPostgresArtifactCommentAuthz({ pool, currentIdentity, sharingPolicy: async () => ({ allowPublicSharing: true }) });
    expect(await closedAuthz({ identity: sessionFor('bob'), workspaceId: 'workspace-a', artifactId: publicId })).toEqual(NOT_FOUND);
    expect(await throwingAuthz({ identity: sessionFor('bob'), workspaceId: 'workspace-a', artifactId: publicId })).toEqual(NOT_FOUND);
    expect(await malformedAuthz({ identity: sessionFor('bob'), workspaceId: 'workspace-a', artifactId: publicId })).toEqual(NOT_FOUND);
    expect(await openAuthz({ identity: sessionFor('bob'), workspaceId: 'workspace-a', artifactId: publicId })).toMatchObject({ ok: true });
    expect(await closedAuthz({ identity: sessionFor('dave'), workspaceId: 'workspace-a', artifactId: publicId, action: 'delete' as never })).toEqual(FORBIDDEN);
    await pool.query(`UPDATE cm_identity.cm_tenant_memberships SET status = 'pending' WHERE tenant_id = 'tenant-a' AND user_id = 'alice'`);
    for (const action of ['comment', 'read'] as const) {
      expect(await closedAuthz({ identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: privateId, action })).toEqual(NOT_FOUND);
    }
    await pool.query(`UPDATE cm_identity.cm_tenant_memberships SET status = 'approved' WHERE tenant_id = 'tenant-a' AND user_id = 'alice'`);
    await pool.query(`DELETE FROM cm_identity.cm_workspace_members WHERE workspace_id = 'workspace-a' AND user_id = 'alice'`);
    for (const action of ['comment', 'read'] as const) {
      expect(await closedAuthz({ identity: sessionFor('alice'), workspaceId: 'workspace-a', artifactId: privateId, action })).toEqual(NOT_FOUND);
    }
  });
});
