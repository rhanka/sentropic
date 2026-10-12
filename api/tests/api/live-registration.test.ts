import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  connectorTenantEnrollments,
  liveGitDeclarations,
} from '../../src/db/control-schema';
import {
  tenants,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { resolveOAuthIssuer } from '../../src/routes/auth/oauth';
import {
  PostgresLiveDeclarationStore,
  canonicalLiveDeclarationIdentity,
  deriveCloneIdentity,
  deriveWorktreeIdentity,
  deriveDeclarationIdentity,
  INITIAL_DECLARATION_REVISION,
  INITIAL_BINDING_REVISION,
  POLICY_VERSION,
} from '../../src/services/cluster-mesh/live-declarations';

const store = new PostgresLiveDeclarationStore(canonicalLiveDeclarationIdentity);

const TEST_TENANT = 'tenant-live-test';
const TEST_USER_AUTHORIZED = 'user-live-alice';
const TEST_USER_UNAUTHORIZED = 'user-live-bob';
const TEST_USER_ADMIN_BIND = 'user-live-charlie';
const TEST_CODE_WORKSPACE = 'ws-code-authorized';
const TEST_NEUTRAL_WORKSPACE = 'ws-neutral-decl';
const TEST_HIDDEN_WORKSPACE = 'ws-hidden-code';
const TEST_ADMIN_NEUTRAL_WORKSPACE = 'ws-admin-neutral';
const ALL_TEST_USERS = [TEST_USER_AUTHORIZED, TEST_USER_UNAUTHORIZED, TEST_USER_ADMIN_BIND];
const ALL_TEST_WORKSPACES = [TEST_CODE_WORKSPACE, TEST_NEUTRAL_WORKSPACE, TEST_HIDDEN_WORKSPACE, TEST_ADMIN_NEUTRAL_WORKSPACE];

async function cleanupTestData() {
  await db.delete(liveGitDeclarations).where(eq(liveGitDeclarations.tenantId, TEST_TENANT));
  await db.delete(connectorTenantEnrollments).where(eq(connectorTenantEnrollments.tenantId, TEST_TENANT));
  await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, ALL_TEST_WORKSPACES));
  await db.delete(workspaces).where(inArray(workspaces.id, ALL_TEST_WORKSPACES));
  await db.delete(users).where(inArray(users.id, ALL_TEST_USERS));
  await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
}

beforeEach(async () => {
  await cleanupTestData();
  await db.insert(tenants).values({ id: TEST_TENANT, name: TEST_TENANT, status: 'active' });
  await db.insert(users).values(ALL_TEST_USERS.map((id) => ({ id, email: `${id}@example.com`, displayName: id, role: 'user' as const })));
  await db.insert(workspaces).values([
    { id: TEST_CODE_WORKSPACE, name: 'Code WS', tenantId: TEST_TENANT, type: 'code' },
    { id: TEST_NEUTRAL_WORKSPACE, name: 'Neutral WS', tenantId: TEST_TENANT, type: 'neutral' },
    { id: TEST_HIDDEN_WORKSPACE, name: 'Hidden WS', tenantId: TEST_TENANT, type: 'code', hiddenAt: new Date() },
    { id: TEST_ADMIN_NEUTRAL_WORKSPACE, name: 'Admin Neutral WS', tenantId: TEST_TENANT, type: 'ai-priorities' },
  ]);
  await db.insert(workspaceMemberships).values([
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_AUTHORIZED, role: 'editor' },
    { workspaceId: TEST_ADMIN_NEUTRAL_WORKSPACE, userId: TEST_USER_ADMIN_BIND, role: 'admin' },
  ]);
  await db.insert(connectorTenantEnrollments).values([
    { principalSub: TEST_USER_ADMIN_BIND, connectorInstanceId: 'conn-admin', tenantId: TEST_TENANT, status: 'active' },
    { principalSub: TEST_USER_AUTHORIZED, connectorInstanceId: 'conn-user', tenantId: TEST_TENANT, status: 'active' },
  ]);
});
afterEach(async () => { await cleanupTestData(); });

function makeDeclaration(overrides: Record<string, unknown> = {}) {
  const clone = deriveCloneIdentity({ hostScope: 'host:test', commonDirRealpath: '/srv/repo/.git', commonDirProjectFingerprint: 'proj-fp-1', identityUncertainty: [], oidAlgorithm: 'sha1' });
  const worktree = deriveWorktreeIdentity({ hostScope: 'host:test', clone, worktreePath: '/srv/repo', gitDir: '/srv/repo/.git', worktreeFingerprint: 'ws:test-1', identityUncertainty: [] });
  const identity = deriveDeclarationIdentity({ hostScope: 'host:test', clone, worktree });
  return { tenant: TEST_TENANT, principal: TEST_USER_AUTHORIZED, hostFingerprint: 'ws:test-1', identityUncertainty: [] as const, declarationId: identity.declarationId, cloneId: identity.cloneId, worktreeId: identity.worktreeId, authorizedRoots: ['/srv/repo'], liveCapability: 'live' as const, policyVersion: POLICY_VERSION, declarationRevision: INITIAL_DECLARATION_REVISION, ...overrides };
}

describe('live registration product-binding persistence (L6a)', () => {
  it('product declarations use authorized code-workspace bindings without changing membership or enrollment semantics', async () => {
    const issuer = resolveOAuthIssuer();
    const membershipsBefore = await db.select().from(workspaceMemberships);
    const enrollmentsBefore = await db.select().from(connectorTenantEnrollments);

    const authorized = makeDeclaration({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    await store.save(authorized as never);

    const found = await store.find(authorized.tenant, authorized.declarationId, authorized.cloneId, authorized.worktreeId);
    expect(found).toMatchObject({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    });

    await expect(store.save(makeDeclaration({
      serverWorkspaceId: 'ws-non-existent',
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/not found or hidden/);

    await expect(store.save(makeDeclaration({
      serverWorkspaceId: TEST_NEUTRAL_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/live Git indexing requires a code workspace/);

    await expect(store.save(makeDeclaration({
      serverWorkspaceId: TEST_HIDDEN_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/not found or hidden/);

    await expect(store.save(makeDeclaration({
      principal: TEST_USER_UNAUTHORIZED,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/not an authorized member/);

    await expect(store.save(makeDeclaration({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: 'https://untrusted.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/serverIssuer mismatch/);

    const membershipsAfter = await db.select().from(workspaceMemberships);
    const enrollmentsAfter = await db.select().from(connectorTenantEnrollments);
    expect(membershipsAfter).toEqual(membershipsBefore);
    expect(enrollmentsAfter).toEqual(enrollmentsBefore);
  });

  it('admin-gated bind and default transcript persistence do not imply live authorization', async () => {
    const issuer = resolveOAuthIssuer();
    const membershipsBefore = await db.select().from(workspaceMemberships);
    const enrollmentsBefore = await db.select().from(connectorTenantEnrollments);

    await expect(store.save(makeDeclaration({
      principal: TEST_USER_ADMIN_BIND,
      serverWorkspaceId: TEST_ADMIN_NEUTRAL_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/live Git indexing requires a code workspace/);

    await expect(store.save(makeDeclaration({
      principal: TEST_USER_ADMIN_BIND,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/not an authorized member/);

    const membershipsAfter = await db.select().from(workspaceMemberships);
    const enrollmentsAfter = await db.select().from(connectorTenantEnrollments);
    expect(membershipsAfter).toEqual(membershipsBefore);
    expect(enrollmentsAfter).toEqual(enrollmentsBefore);
  });

  it('enforces complete product-binding triplet and initial revision 1', async () => {
    const issuer = resolveOAuthIssuer();
    const partial = makeDeclaration({ serverWorkspaceId: TEST_CODE_WORKSPACE });
    await expect(store.save(partial as never)).rejects.toThrow();

    const bound = makeDeclaration({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    await store.save(bound as never);
    const found = await store.find(TEST_TENANT, bound.declarationId, bound.cloneId, bound.worktreeId);
    expect(found).toMatchObject({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    });
  });

  it('revocation targets exactly one declaration by the declarationId/cloneId/worktreeId triple', async () => {
    const issuer = resolveOAuthIssuer();
    const decl = makeDeclaration({
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    await store.save(decl as never);

    const purge = { purgePrivateSnapshots: true as const, purgeDerivedIndexes: true as const, revokeDecryptability: true as const, preserveCommittedHistory: true as const };
    const withdrawal = { declarationId: decl.declarationId, tenant: decl.tenant, cloneId: decl.cloneId, worktreeId: 'wt:mismatch', declarationRevision: decl.declarationRevision, reason: 'workspace-remove' as const, requestPrivatePurge: purge };
    expect(await store.recordWithdrawal(withdrawal as never, '2026-10-12T14:00:00Z')).toBe(false);

    const matching = { ...withdrawal, worktreeId: decl.worktreeId };
    expect(await store.recordWithdrawal(matching as never, '2026-10-12T14:01:00Z')).toBe(true);
    expect(await store.status(TEST_TENANT, decl.declarationId, decl.cloneId, decl.worktreeId)).toBe('withdrawn');

    const [row] = await db.select().from(liveGitDeclarations).where(eq(liveGitDeclarations.tenantId, TEST_TENANT));
    expect(row.status).toBe('withdrawn');
  });

  it('persists declarations with missing_history uncertainty and omitted fingerprint', async () => {
    const clone = deriveCloneIdentity({ hostScope: 'host:test', commonDirRealpath: '/srv/empty/.git', identityUncertainty: ['missing_history'], oidAlgorithm: 'sha1' });
    const worktree = deriveWorktreeIdentity({ hostScope: 'host:test', clone, worktreePath: '/srv/empty', gitDir: '/srv/empty/.git', identityUncertainty: ['missing_history'] });
    const identity = deriveDeclarationIdentity({ hostScope: 'host:test', clone, worktree });
    const decl = { tenant: TEST_TENANT, principal: TEST_USER_AUTHORIZED, identityUncertainty: ['missing_history'] as const, declarationId: identity.declarationId, cloneId: identity.cloneId, worktreeId: identity.worktreeId, authorizedRoots: ['/srv/empty'], liveCapability: 'live' as const, policyVersion: POLICY_VERSION, declarationRevision: INITIAL_DECLARATION_REVISION };
    await store.save(decl as never);
    const found = await store.find(TEST_TENANT, decl.declarationId, decl.cloneId, decl.worktreeId);
    expect(found).toMatchObject({ declarationId: identity.declarationId, identityUncertainty: ['missing_history'] });
    expect(found?.hostFingerprint).toBeUndefined();
  });
});
