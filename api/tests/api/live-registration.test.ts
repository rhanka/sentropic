import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  connectorTenantEnrollments,
  liveGitDeclarations,
} from '../../src/db/control-schema';
import {
  chatSessions,
  tenantMemberships,
  tenants,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { defaultCodeWorkspaceBindingAuthorizer } from '../../src/routes/namespaces/code-git-ports';
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

const store = new PostgresLiveDeclarationStore(
  canonicalLiveDeclarationIdentity,
  defaultCodeWorkspaceBindingAuthorizer,
);

const TEST_TENANT = 'tenant-live-test';
const TEST_USER_AUTHORIZED = 'user-live-alice';
const TEST_USER_UNAUTHORIZED = 'user-live-bob';
const TEST_USER_ADMIN_BIND = 'user-live-charlie';
const TEST_USER_VIEWER = 'user-live-viewer';
const TEST_USER_COMMENTER = 'user-live-commenter';
const TEST_USER_SUSPENDED = 'user-live-suspended';
const TEST_USER_DISABLED = 'user-live-disabled';
const TEST_USER_REVOKED_TENANT = 'user-live-revoked-tenant';
const TEST_CODE_WORKSPACE = 'ws-code-authorized';
const TEST_NEUTRAL_WORKSPACE = 'ws-neutral-decl';
const TEST_HIDDEN_WORKSPACE = 'ws-hidden-code';
const TEST_ADMIN_NEUTRAL_WORKSPACE = 'ws-admin-neutral';
const ALL_TEST_USERS = [
  TEST_USER_AUTHORIZED,
  TEST_USER_UNAUTHORIZED,
  TEST_USER_ADMIN_BIND,
  TEST_USER_VIEWER,
  TEST_USER_COMMENTER,
  TEST_USER_SUSPENDED,
  TEST_USER_DISABLED,
  TEST_USER_REVOKED_TENANT,
];
const ALL_TEST_WORKSPACES = [TEST_CODE_WORKSPACE, TEST_NEUTRAL_WORKSPACE, TEST_HIDDEN_WORKSPACE, TEST_ADMIN_NEUTRAL_WORKSPACE];

async function cleanupTestData() {
  await db.delete(liveGitDeclarations).where(eq(liveGitDeclarations.tenantId, TEST_TENANT));
  await db.delete(connectorTenantEnrollments).where(eq(connectorTenantEnrollments.tenantId, TEST_TENANT));
  await db.delete(chatSessions).where(inArray(chatSessions.workspaceId, ALL_TEST_WORKSPACES));
  await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, ALL_TEST_WORKSPACES));
  await db.delete(workspaces).where(inArray(workspaces.id, ALL_TEST_WORKSPACES));
  await db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, TEST_TENANT));
  await db.delete(users).where(inArray(users.id, ALL_TEST_USERS));
  await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
}

beforeEach(async () => {
  await cleanupTestData();
  await db.insert(tenants).values({ id: TEST_TENANT, name: TEST_TENANT, status: 'active' });
  await db.insert(users).values([
    { id: TEST_USER_AUTHORIZED, email: `${TEST_USER_AUTHORIZED}@example.com`, displayName: TEST_USER_AUTHORIZED, role: 'user', accountStatus: 'active' },
    { id: TEST_USER_UNAUTHORIZED, email: `${TEST_USER_UNAUTHORIZED}@example.com`, displayName: TEST_USER_UNAUTHORIZED, role: 'user', accountStatus: 'active' },
    { id: TEST_USER_ADMIN_BIND, email: `${TEST_USER_ADMIN_BIND}@example.com`, displayName: TEST_USER_ADMIN_BIND, role: 'user', accountStatus: 'active' },
    { id: TEST_USER_VIEWER, email: `${TEST_USER_VIEWER}@example.com`, displayName: TEST_USER_VIEWER, role: 'user', accountStatus: 'active' },
    { id: TEST_USER_COMMENTER, email: `${TEST_USER_COMMENTER}@example.com`, displayName: TEST_USER_COMMENTER, role: 'user', accountStatus: 'active' },
    { id: TEST_USER_SUSPENDED, email: `${TEST_USER_SUSPENDED}@example.com`, displayName: TEST_USER_SUSPENDED, role: 'user', accountStatus: 'suspended' },
    { id: TEST_USER_DISABLED, email: `${TEST_USER_DISABLED}@example.com`, displayName: TEST_USER_DISABLED, role: 'user', accountStatus: 'active', disabledAt: new Date() },
    { id: TEST_USER_REVOKED_TENANT, email: `${TEST_USER_REVOKED_TENANT}@example.com`, displayName: TEST_USER_REVOKED_TENANT, role: 'user', accountStatus: 'active' },
  ]);
  await db.insert(tenantMemberships).values([
    { tenantId: TEST_TENANT, userId: TEST_USER_AUTHORIZED, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_UNAUTHORIZED, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_ADMIN_BIND, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_VIEWER, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_COMMENTER, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_SUSPENDED, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_DISABLED, status: 'approved', role: 'member' },
    { tenantId: TEST_TENANT, userId: TEST_USER_REVOKED_TENANT, status: 'suspended', role: 'member' },
  ]);
  await db.insert(workspaces).values([
    { id: TEST_CODE_WORKSPACE, name: 'Code WS', tenantId: TEST_TENANT, type: 'code' },
    { id: TEST_NEUTRAL_WORKSPACE, name: 'Neutral WS', tenantId: TEST_TENANT, type: 'neutral' },
    { id: TEST_HIDDEN_WORKSPACE, name: 'Hidden WS', tenantId: TEST_TENANT, type: 'code', hiddenAt: new Date() },
    { id: TEST_ADMIN_NEUTRAL_WORKSPACE, name: 'Admin Neutral WS', tenantId: TEST_TENANT, type: 'ai-priorities' },
  ]);
  await db.insert(workspaceMemberships).values([
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_AUTHORIZED, role: 'editor' },
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_VIEWER, role: 'viewer' },
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_COMMENTER, role: 'commenter' },
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_SUSPENDED, role: 'editor' },
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_DISABLED, role: 'editor' },
    { workspaceId: TEST_CODE_WORKSPACE, userId: TEST_USER_REVOKED_TENANT, role: 'editor' },
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
    const TEST_SESSION_ID = 'session-live-transcript-1';
    await db.insert(chatSessions).values({
      id: TEST_SESSION_ID,
      userId: TEST_USER_ADMIN_BIND,
      workspaceId: TEST_ADMIN_NEUTRAL_WORKSPACE,
      title: 'Default transcript session',
    });

    const membershipsBefore = await db.select().from(workspaceMemberships);
    const enrollmentsBefore = await db.select().from(connectorTenantEnrollments);
    const transcriptsBefore = await db.select().from(chatSessions).where(eq(chatSessions.id, TEST_SESSION_ID));

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
    const transcriptsAfter = await db.select().from(chatSessions).where(eq(chatSessions.id, TEST_SESSION_ID));
    expect(membershipsAfter).toEqual(membershipsBefore);
    expect(enrollmentsAfter).toEqual(enrollmentsBefore);
    expect(transcriptsAfter).toEqual(transcriptsBefore);
  });

  it('refuses product bindings for viewer, commenter, inactive account, or inactive tenant membership (N1)', async () => {
    const issuer = resolveOAuthIssuer();

    // Refusal: viewer role
    await expect(store.save(makeDeclaration({
      principal: TEST_USER_VIEWER,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/requires at least editor role/);

    // Refusal: commenter role
    await expect(store.save(makeDeclaration({
      principal: TEST_USER_COMMENTER,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/requires at least editor role/);

    // Refusal: suspended account
    await expect(store.save(makeDeclaration({
      principal: TEST_USER_SUSPENDED,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/is not active or disabled/);

    // Refusal: disabled account
    await expect(store.save(makeDeclaration({
      principal: TEST_USER_DISABLED,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/is not active or disabled/);

    // Refusal: suspended/revoked tenant membership
    await expect(store.save(makeDeclaration({
      principal: TEST_USER_REVOKED_TENANT,
      serverWorkspaceId: TEST_CODE_WORKSPACE,
      serverIssuer: issuer,
      bindingRevision: INITIAL_BINDING_REVISION,
    }) as never)).rejects.toThrow(/not an approved member of tenant/);
  });

  it('declarations without workspace binding require approved tenant membership (m1)', async () => {
    // Unbound declaration with approved member succeeds
    const unboundAuthorized = makeDeclaration({ principal: TEST_USER_AUTHORIZED });
    delete (unboundAuthorized as Record<string, unknown>).serverWorkspaceId;
    delete (unboundAuthorized as Record<string, unknown>).serverIssuer;
    delete (unboundAuthorized as Record<string, unknown>).bindingRevision;
    await store.save(unboundAuthorized as never);
    expect(await store.find(TEST_TENANT, unboundAuthorized.declarationId, unboundAuthorized.cloneId, unboundAuthorized.worktreeId)).not.toBeNull();

    // Unbound declaration with suspended tenant membership fails
    const unboundSuspended = makeDeclaration({
      principal: TEST_USER_REVOKED_TENANT,
      declarationId: 'decl:unbound-suspended',
      cloneId: 'clone:unbound-suspended',
      worktreeId: 'wt:unbound-suspended',
    });
    delete (unboundSuspended as Record<string, unknown>).serverWorkspaceId;
    delete (unboundSuspended as Record<string, unknown>).serverIssuer;
    delete (unboundSuspended as Record<string, unknown>).bindingRevision;
    await expect(store.save(unboundSuspended as never)).rejects.toThrow(/not an approved member of tenant/);
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

  it('replays declared registrations after projection loss and never resurrects withdrawn declarations', async () => {
    const declA = makeDeclaration();
    const declB = makeDeclaration({
      declarationId: 'decl:test-second-b',
      cloneId: 'clone:test-second-b',
      worktreeId: 'wt:test-second-b',
    });

    await store.save(declA as never);
    await store.save(declB as never);

    const purge = {
      purgePrivateSnapshots: true as const,
      purgeDerivedIndexes: true as const,
      revokeDecryptability: true as const,
      preserveCommittedHistory: true as const,
    };
    const withdrawal = {
      declarationId: declB.declarationId,
      tenant: declB.tenant,
      cloneId: declB.cloneId,
      worktreeId: declB.worktreeId,
      declarationRevision: declB.declarationRevision,
      reason: 'workspace-remove' as const,
      requestPrivatePurge: purge,
    };
    expect(await store.recordWithdrawal(withdrawal as never, '2026-10-12T15:00:00Z')).toBe(true);

    const replayed = await store.list(TEST_TENANT);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].declarationId).toBe(declA.declarationId);
    expect(await store.status(TEST_TENANT, declB.declarationId, declB.cloneId, declB.worktreeId)).toBe('withdrawn');
  });

  it('rejects revision races and preserves monotonic declaration revisions', async () => {
    const decl = makeDeclaration();
    await store.save(decl as never);

    await expect(store.save(decl as never)).rejects.toThrow(/already exists/);

    const rev2 = { ...decl, declarationRevision: 2, authorizedRoots: ['/srv/repo', '/srv/repo/v2'] };
    await store.save(rev2 as never);

    const found = await store.find(decl.tenant, decl.declarationId, decl.cloneId, decl.worktreeId);
    expect(found?.declarationRevision).toBe(2);

    await expect(store.save(rev2 as never)).rejects.toThrow(/revision conflict/);

    const rev4 = { ...decl, declarationRevision: 4 };
    await expect(store.save(rev4 as never)).rejects.toThrow(/revision conflict/);
  });
});
