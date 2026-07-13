import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { serviceClients, tenantMemberships, tenants, workspaces } from '../../../src/db/schema';
import { env } from '../../../src/config/env';
import {
  reconcileTenantId,
  resetResolveTenantCache,
  resolveTenant,
  TenantResolutionError,
} from '../../../src/services/tenancy/resolve-tenant';
import {
  getTenantResolutionMetrics,
  resetTenantResolutionMetrics,
} from '../../../src/services/tenancy/tenant-resolution-metrics';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

// ARCH-11 G1b — resolveTenant seam + SHADOW mode (spec §3, §4.3). Proves: resolveTenant
// correctness per input (fail-closed), a NON-VACUOUS ≥2-org isolation, and the three rollout
// modes — alias = legacy, shadow = ZERO behavior change (divergence logged, not enforced),
// strict = resolveTenant authoritative + fail-closed. CODE only (G1a shipped the columns).

const ORG_A = 'arch11g1b-org-a';
const ORG_B = 'arch11g1b-org-b';
const TEST_ORGS = [ORG_A, ORG_B];
const SERVICE_CLIENT_A = 'arch11g1b-svc-a';
const seededWorkspaceIds: string[] = [];
const originalMode = env.TENANT_RESOLUTION_MODE;

async function seedOrg(id: string): Promise<void> {
  await db.insert(tenants).values({ id, name: id, status: 'active' }).onConflictDoNothing();
}

async function seedWorkspace(id: string, tenantId: string, ownerUserId?: string): Promise<void> {
  await db
    .insert(workspaces)
    .values({ id, name: `ws-${id}`, tenantId, ...(ownerUserId ? { ownerUserId } : {}) })
    .onConflictDoNothing();
  seededWorkspaceIds.push(id);
}

async function seedMembership(tenantId: string, userId: string, status = 'approved'): Promise<void> {
  await db.insert(tenantMemberships).values({ tenantId, userId, status, role: 'member' }).onConflictDoNothing();
}

describe('ARCH-11 G1b — resolveTenant seam + SHADOW mode', () => {
  beforeEach(async () => {
    resetResolveTenantCache();
    resetTenantResolutionMetrics();
    env.TENANT_RESOLUTION_MODE = 'shadow';
    await seedOrg(ORG_A);
    await seedOrg(ORG_B);
  });

  afterEach(async () => {
    env.TENANT_RESOLUTION_MODE = originalMode;
    resetResolveTenantCache();
    resetTenantResolutionMetrics();
    await db.delete(serviceClients).where(eq(serviceClients.clientId, SERVICE_CLIENT_A));
    if (seededWorkspaceIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, seededWorkspaceIds));
      seededWorkspaceIds.length = 0;
    }
    await db.delete(tenantMemberships).where(inArray(tenantMemberships.tenantId, TEST_ORGS));
    await db.delete(tenants).where(inArray(tenants.id, TEST_ORGS));
    await cleanupAuthData();
  });

  // ---------------------------------------------------------------------------
  // resolveTenant correctness per input (spec §3), fail-closed.
  // ---------------------------------------------------------------------------

  it('{ workspaceId } resolves the workspace tenant; a miss is fail-closed unknown', async () => {
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A);

    expect(await resolveTenant({ workspaceId: wsA })).toEqual({ tenantId: ORG_A });
    // Invariant (1): never returns a workspaceId as tenantId.
    expect(await resolveTenant({ workspaceId: wsA })).not.toEqual({ tenantId: wsA });
    // Miss = deny (fail-closed).
    expect(await resolveTenant({ workspaceId: `ws-missing-${crypto.randomUUID()}` })).toEqual({ error: 'unknown' });
  });

  it('{ workspaceId, userId } cross-checks approved membership; a non-member fails closed', async () => {
    const member = await createTestUser({ displayName: 'Member A', withWorkspace: false });
    const stranger = await createTestUser({ displayName: 'Stranger', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, member.id);
    await seedMembership(ORG_A, member.id, 'approved');

    // Approved member of the org the workspace claims → resolves.
    expect(await resolveTenant({ workspaceId: wsA, userId: member.id })).toEqual({ tenantId: ORG_A });
    resetResolveTenantCache();
    // A user with no approved membership in that org → fail-closed ambiguous_tenant.
    expect(await resolveTenant({ workspaceId: wsA, userId: stranger.id })).toEqual({ error: 'ambiguous_tenant' });
  });

  it('{ workspaceId, userId } treats a non-approved (requested) membership as fail-closed', async () => {
    const pending = await createTestUser({ displayName: 'Pending', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, pending.id);
    await seedMembership(ORG_A, pending.id, 'requested');

    expect(await resolveTenant({ workspaceId: wsA, userId: pending.id })).toEqual({ error: 'ambiguous_tenant' });
  });

  it('{ clientId } resolves service_clients.tenant_id (NOT oauth_clients); a miss is unknown', async () => {
    await db.insert(serviceClients).values({
      id: `svc-${crypto.randomUUID()}`,
      clientId: SERVICE_CLIENT_A,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
      tenantId: ORG_A,
    });

    expect(await resolveTenant({ clientId: SERVICE_CLIENT_A })).toEqual({ tenantId: ORG_A });
    expect(await resolveTenant({ clientId: `svc-missing-${crypto.randomUUID()}` })).toEqual({ error: 'unknown' });
  });

  it('{ userId } resolves a single approved membership; zero = unknown, multiple = ambiguous', async () => {
    const solo = await createTestUser({ displayName: 'Solo', withWorkspace: false });
    const dual = await createTestUser({ displayName: 'Dual', withWorkspace: false });
    const none = await createTestUser({ displayName: 'None', withWorkspace: false });
    await seedMembership(ORG_A, solo.id, 'approved');
    await seedMembership(ORG_A, dual.id, 'approved');
    await seedMembership(ORG_B, dual.id, 'approved');

    expect(await resolveTenant({ userId: solo.id })).toEqual({ tenantId: ORG_A });
    expect(await resolveTenant({ userId: dual.id })).toEqual({ error: 'ambiguous_tenant' });
    expect(await resolveTenant({ userId: none.id })).toEqual({ error: 'unknown' });
  });

  // ---------------------------------------------------------------------------
  // NON-VACUOUS ≥2-org isolation (spec §5 crit-7): org-B never resolves org-A.
  // ---------------------------------------------------------------------------

  it('NON-VACUOUS ≥2-org: org-B workspace/user/client resolve org-B and never org-A', async () => {
    const userA = await createTestUser({ displayName: 'User A', withWorkspace: false });
    const userB = await createTestUser({ displayName: 'User B', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    const wsB = `ws-${ORG_B}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, userA.id);
    await seedWorkspace(wsB, ORG_B, userB.id);
    await seedMembership(ORG_A, userA.id, 'approved');
    await seedMembership(ORG_B, userB.id, 'approved');
    await db.insert(serviceClients).values({
      id: `svc-${crypto.randomUUID()}`,
      clientId: SERVICE_CLIENT_A,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
      tenantId: ORG_A,
    });

    // Each org resolves its own tenant, distinctly.
    expect(await resolveTenant({ workspaceId: wsA })).toEqual({ tenantId: ORG_A });
    expect(await resolveTenant({ workspaceId: wsB })).toEqual({ tenantId: ORG_B });
    // org-B's workspace never resolves to org-A.
    expect(await resolveTenant({ workspaceId: wsB })).not.toEqual({ tenantId: ORG_A });
    // userA (org-A only) cannot resolve org-B's workspace — cross-org access is fail-closed.
    expect(await resolveTenant({ workspaceId: wsB, userId: userA.id })).toEqual({ error: 'ambiguous_tenant' });
    // The service client is org-A-bound and never leaks org-B.
    expect(await resolveTenant({ clientId: SERVICE_CLIENT_A })).toEqual({ tenantId: ORG_A });
    // userB resolves org-B (single membership), never org-A.
    expect(await resolveTenant({ userId: userB.id })).toEqual({ tenantId: ORG_B });
  });

  // ---------------------------------------------------------------------------
  // The three rollout modes (spec §4.3) via reconcileTenantId.
  // ---------------------------------------------------------------------------

  it('alias mode: pure legacy (tenantId := workspaceId); the resolver is never consulted', async () => {
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A);
    env.TENANT_RESOLUTION_MODE = 'alias';

    const used = await reconcileTenantId({ workspaceId: wsA, path: 'test:alias' });
    expect(used).toBe(wsA); // legacy alias, unchanged
    // No resolver call in alias mode → no metrics recorded at all.
    expect(getTenantResolutionMetrics()).toEqual({ total: {}, divergence: {} });
  });

  it('shadow mode: ZERO behavior change — returns the legacy value even when tenant != workspaceId', async () => {
    const userA = await createTestUser({ displayName: 'Shadow Member', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, userA.id);
    await seedMembership(ORG_A, userA.id, 'approved');
    env.TENANT_RESOLUTION_MODE = 'shadow';

    // Even though resolveTenant would return ORG_A, shadow returns the legacy workspaceId.
    const used = await reconcileTenantId({ workspaceId: wsA, userId: userA.id, path: 'test:shadow-ok' });
    expect(used).toBe(wsA); // behavior byte-identical to alias
    expect(used).not.toBe(ORG_A);
    const metrics = getTenantResolutionMetrics();
    // The denominator is incremented; a SUCCESSFUL resolution is NOT a divergence.
    expect(metrics.total['test:shadow-ok']).toBe(1);
    expect(metrics.divergence['test:shadow-ok']).toBeUndefined();
  });

  it('shadow mode: a fail-close resolution is recorded as divergence but still returns legacy', async () => {
    const stranger = await createTestUser({ displayName: 'Shadow Stranger', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A);
    // stranger has NO approved membership in ORG_A → resolveTenant → ambiguous_tenant.
    env.TENANT_RESOLUTION_MODE = 'shadow';

    const used = await reconcileTenantId({ workspaceId: wsA, userId: stranger.id, path: 'test:shadow-diverge' });
    expect(used).toBe(wsA); // STILL legacy — shadow never enforces
    const metrics = getTenantResolutionMetrics();
    expect(metrics.total['test:shadow-diverge']).toBe(1);
    expect(metrics.divergence['test:shadow-diverge']).toBe(1); // divergence logged, not enforced
  });

  it('strict mode: resolveTenant is authoritative and fail-closed', async () => {
    const userA = await createTestUser({ displayName: 'Strict Member', withWorkspace: false });
    const stranger = await createTestUser({ displayName: 'Strict Stranger', withWorkspace: false });
    const wsA = `ws-${ORG_A}-${crypto.randomUUID()}`;
    await seedWorkspace(wsA, ORG_A, userA.id);
    await seedMembership(ORG_A, userA.id, 'approved');
    env.TENANT_RESOLUTION_MODE = 'strict';

    // Authoritative: strict returns the RESOLVED real tenant, not the workspaceId alias.
    const used = await reconcileTenantId({ workspaceId: wsA, userId: userA.id, path: 'test:strict-ok' });
    expect(used).toBe(ORG_A);
    expect(used).not.toBe(wsA);

    // Fail-closed: an unresolved tenant THROWS rather than falling back to the workspaceId.
    resetResolveTenantCache();
    await expect(
      reconcileTenantId({ workspaceId: wsA, userId: stranger.id, path: 'test:strict-deny' }),
    ).rejects.toBeInstanceOf(TenantResolutionError);
  });
});
