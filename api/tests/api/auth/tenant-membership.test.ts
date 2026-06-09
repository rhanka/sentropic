import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { oauthClients, tenants, tenantMemberships } from '../../../src/db/schema';
import {
  requestMembership,
  decideMembership,
  listTenantMemberships,
  listTenantClients,
  isTenantAdmin,
  TenantAdminRequiredError,
  InvalidMembershipTransitionError,
  MembershipNotFoundError,
} from '../../../src/services/auth/tenant-membership';
import { createTestUser, cleanupAuthData } from '../../utils/auth-helper';

// BR-39e Lot 2 — tenant-scoped membership acceptance (service level).
const TENANT_A = 'tm-a';
const TENANT_B = 'tm-b';
const TEST_TENANTS = [TENANT_A, TENANT_B];

async function seedTenant(id: string, status: 'active' | 'suspended' = 'active') {
  await db.insert(tenants).values({ id, name: id, status }).onConflictDoUpdate({
    target: tenants.id,
    set: { status },
  });
}

async function makeMembership(tenantId: string, userId: string, status: string, role = 'member') {
  await db
    .insert(tenantMemberships)
    .values({ tenantId, userId, status, role })
    .onConflictDoUpdate({
      target: [tenantMemberships.tenantId, tenantMemberships.userId],
      set: { status, role },
    });
}

describe('BR-39e tenant membership acceptance (Lot 2)', () => {
  beforeEach(async () => {
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
  });

  afterEach(async () => {
    await db.delete(oauthClients).where(inArray(oauthClients.clientId, ['rp-a-test', 'rp-b-test', 'rp-default-test']));
    await db.delete(tenantMemberships).where(inArray(tenantMemberships.tenantId, TEST_TENANTS));
    await db.delete(tenants).where(inArray(tenants.id, TEST_TENANTS));
    await cleanupAuthData();
  });

  async function makeClient(clientId: string, tenantId?: string) {
    await db
      .insert(oauthClients)
      .values({
        id: `client-${clientId}`,
        clientId,
        name: clientId,
        redirectUris: ['https://example.test/cb'],
        allowedScopes: ['openid'],
        tokenEndpointAuthMethod: 'none',
        ...(tenantId ? { tenantId } : {}),
      })
      .onConflictDoNothing();
  }

  it('requestMembership creates a `requested` row for an active tenant', async () => {
    const user = await createTestUser({ email: `req-${crypto.randomUUID()}@example.com`, displayName: 'U' });
    const res = await requestMembership(user.id, TENANT_A);
    expect(res).toEqual({ status: 'pending' });
    const [m] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, TENANT_A), eq(tenantMemberships.userId, user.id)));
    expect(m?.status).toBe('requested');
    expect(m?.role).toBe('member');
  });

  it('anti-enumeration: a request for a non-existent tenant returns pending but creates no row', async () => {
    const user = await createTestUser({ email: `noenum-${crypto.randomUUID()}@example.com`, displayName: 'U' });
    const res = await requestMembership(user.id, 'tenant-does-not-exist');
    expect(res).toEqual({ status: 'pending' });
    const rows = await db
      .select()
      .from(tenantMemberships)
      .where(eq(tenantMemberships.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it('anti-enumeration: a request for a suspended tenant returns pending but creates no row', async () => {
    await seedTenant(TENANT_A, 'suspended');
    const user = await createTestUser({ email: `susp-${crypto.randomUUID()}@example.com`, displayName: 'U' });
    const res = await requestMembership(user.id, TENANT_A);
    expect(res).toEqual({ status: 'pending' });
    const rows = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, TENANT_A), eq(tenantMemberships.userId, user.id)));
    expect(rows).toHaveLength(0);
  });

  it('a non-admin caller cannot decide (403 / TenantAdminRequiredError)', async () => {
    const admin = await createTestUser({ email: `nonadmin-${crypto.randomUUID()}@example.com`, displayName: 'NA' });
    const target = await createTestUser({ email: `target-${crypto.randomUUID()}@example.com`, displayName: 'T' });
    await makeMembership(TENANT_A, target.id, 'requested');
    await expect(decideMembership(admin.id, 'editor', TENANT_A, target.id, 'approve')).rejects.toBeInstanceOf(
      TenantAdminRequiredError,
    );
  });

  it('a tenant admin approves a requested membership (status + audit fields set)', async () => {
    const admin = await createTestUser({ email: `admin-${crypto.randomUUID()}@example.com`, displayName: 'A' });
    const target = await createTestUser({ email: `target-${crypto.randomUUID()}@example.com`, displayName: 'T' });
    await makeMembership(TENANT_A, admin.id, 'approved', 'admin');
    await makeMembership(TENANT_A, target.id, 'requested');

    expect(await isTenantAdmin(admin.id, TENANT_A)).toBe(true);
    const res = await decideMembership(admin.id, 'editor', TENANT_A, target.id, 'approve');
    expect(res.status).toBe('approved');

    const [m] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, TENANT_A), eq(tenantMemberships.userId, target.id)));
    expect(m?.status).toBe('approved');
    expect(m?.approvedByUserId).toBe(admin.id);
    expect(m?.decidedAt).not.toBeNull();
  });

  it('rejects an invalid transition (approve an already-rejected membership -> 409)', async () => {
    const admin = await createTestUser({ email: `adm2-${crypto.randomUUID()}@example.com`, displayName: 'A' });
    const target = await createTestUser({ email: `tgt2-${crypto.randomUUID()}@example.com`, displayName: 'T' });
    await makeMembership(TENANT_A, admin.id, 'approved', 'admin');
    await makeMembership(TENANT_A, target.id, 'rejected');
    await expect(decideMembership(admin.id, 'editor', TENANT_A, target.id, 'approve')).rejects.toBeInstanceOf(
      InvalidMembershipTransitionError,
    );
  });

  it('throws MembershipNotFoundError when deciding a non-existent membership', async () => {
    const admin = await createTestUser({ email: `adm3-${crypto.randomUUID()}@example.com`, displayName: 'A' });
    const ghost = await createTestUser({ email: `ghost-${crypto.randomUUID()}@example.com`, displayName: 'G' });
    await makeMembership(TENANT_A, admin.id, 'approved', 'admin');
    await expect(decideMembership(admin.id, 'editor', TENANT_A, ghost.id, 'approve')).rejects.toBeInstanceOf(
      MembershipNotFoundError,
    );
  });

  it('isolation A->B: a tenant-A admin cannot approve in tenant B', async () => {
    const adminA = await createTestUser({ email: `adminA-${crypto.randomUUID()}@example.com`, displayName: 'AA' });
    const targetB = await createTestUser({ email: `targetB-${crypto.randomUUID()}@example.com`, displayName: 'TB' });
    await makeMembership(TENANT_A, adminA.id, 'approved', 'admin');
    await makeMembership(TENANT_B, targetB.id, 'requested');
    await expect(decideMembership(adminA.id, 'editor', TENANT_B, targetB.id, 'approve')).rejects.toBeInstanceOf(
      TenantAdminRequiredError,
    );
    // And listing tenant B as a tenant-A admin is forbidden too.
    await expect(listTenantMemberships(adminA.id, 'editor', TENANT_B)).rejects.toBeInstanceOf(TenantAdminRequiredError);
  });

  it('a global admin_app can act as approver in any tenant (bootstrap)', async () => {
    const superAdmin = await createTestUser({ email: `super-${crypto.randomUUID()}@example.com`, displayName: 'S' });
    const target = await createTestUser({ email: `tgt4-${crypto.randomUUID()}@example.com`, displayName: 'T' });
    await makeMembership(TENANT_A, target.id, 'requested');
    const res = await decideMembership(superAdmin.id, 'admin_app', TENANT_A, target.id, 'approve');
    expect(res.status).toBe('approved');
  });

  it('Lot 4: a tenant admin lists only their own tenant clients (RP governance)', async () => {
    const admin = await createTestUser({ email: `cadmin-${crypto.randomUUID()}@example.com`, displayName: 'CA' });
    await makeMembership(TENANT_A, admin.id, 'approved', 'admin');
    await makeClient('rp-a-test', TENANT_A);
    await makeClient('rp-b-test', TENANT_B);

    const items = await listTenantClients(admin.id, 'editor', TENANT_A);
    const ids = items.map((row) => row.clientId);
    expect(ids).toContain('rp-a-test');
    expect(ids).not.toContain('rp-b-test');
  });

  it('Lot 4: listing another tenant clients is forbidden (A->B)', async () => {
    const adminA = await createTestUser({ email: `cadminA-${crypto.randomUUID()}@example.com`, displayName: 'CAA' });
    await makeMembership(TENANT_A, adminA.id, 'approved', 'admin');
    await expect(listTenantClients(adminA.id, 'editor', TENANT_B)).rejects.toBeInstanceOf(TenantAdminRequiredError);
  });

  it('Lot 4: a new OAuth client defaults to the `sentropic` tenant', async () => {
    await makeClient('rp-default-test'); // no explicit tenant
    const [row] = await db
      .select({ tenantId: oauthClients.tenantId })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, 'rp-default-test'));
    expect(row?.tenantId).toBe('sentropic');
  });
});
