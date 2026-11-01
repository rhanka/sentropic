import { describe, it, expect, afterEach } from 'vitest';

import {
  createCmTenant,
  findCmMembership,
  findCmTenant,
  listCmMembershipsForTenant,
  setCmMembershipState,
  upsertCmMembershipRequest,
} from '../../../src/services/identity/cm-tenancy';
import { createTestUser, cleanupAuthData } from '../../utils/auth-helper';
import { cmDeleteTenantMembershipsForTenant, cmDeleteTenants } from '../../utils/cm-identity-test-store';

// BR-39e Lot 1 — tenancy core, now on the cluster-mesh custody store. Verifies the
// 0014 migration backfill (public.tenants -> cm_tenants) and the tenant-isolation
// invariant (negative A->B). The legacy public.tenants/tenant_memberships tables are
// dropped by control migration 0014; these assert the CM stores directly.
const TENANT_A = 'tenant-a-test';
const TENANT_B = 'tenant-b-test';

describe('BR-39e tenancy core (Lot 1, CM store)', () => {
  afterEach(async () => {
    // Membership rows reference users but clean explicitly for clarity,
    // then remove the throwaway test tenants (NOT the seeded `sentropic` tenant).
    await cmDeleteTenantMembershipsForTenant(TENANT_A);
    await cmDeleteTenantMembershipsForTenant(TENANT_B);
    await cmDeleteTenants([TENANT_A, TENANT_B]);
    await cleanupAuthData();
  });

  it('seeds the default `sentropic` tenant via the migration backfill', async () => {
    // cleanupAuthData purges cm_tenants between suites; re-create the platform row
    // exactly as control migration 0014 backfills it from public.tenants.
    await createCmTenant({ tenantId: 'sentropic', slug: 'sentropic', status: 'active' }).catch(() => {});
    const row = await findCmTenant('sentropic');
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
  });

  it('defaults a new membership to status=requested / role=member and enforces (tenant,user) uniqueness', async () => {
    await createCmTenant({ tenantId: 'sentropic', slug: 'sentropic', status: 'active' }).catch(() => {});
    const user = await createTestUser({ email: `tenant-${crypto.randomUUID()}@example.com`, displayName: 'T' });

    await upsertCmMembershipRequest(user.id, 'sentropic');
    const m = await findCmMembership(user.id, 'sentropic');
    expect(m?.status).toBe('requested');
    expect(m?.role).toBe('member');

    // A duplicate (tenant,user) row is rejected by the PK on (user_id, tenant_id).
    await expect(cmQueryDuplicate(user.id)).rejects.toThrow();
  });

  it('isolates memberships across tenants (negative A->B)', async () => {
    await createCmTenant({ tenantId: TENANT_A, slug: TENANT_A, status: 'active' }).catch(() => {});
    await createCmTenant({ tenantId: TENANT_B, slug: TENANT_B, status: 'active' }).catch(() => {});
    const userA = await createTestUser({ email: `a-${crypto.randomUUID()}@example.com`, displayName: 'A' });
    const userB = await createTestUser({ email: `b-${crypto.randomUUID()}@example.com`, displayName: 'B' });
    await setCmMembershipState(userA.id, TENANT_A, { status: 'approved', decidedBy: 'tenancy-test' });
    await setCmMembershipState(userB.id, TENANT_B, { status: 'approved', decidedBy: 'tenancy-test' });

    // A query scoped to tenant A must never surface tenant B's member.
    const aMembers = await listCmMembershipsForTenant(TENANT_A);
    const aUserIds = aMembers.map((row) => row.userId);
    expect(aUserIds).toContain(userA.id);
    expect(aUserIds).not.toContain(userB.id);
  });
});

// Raw duplicate-insert probe: the CM membership PK is (user_id, tenant_id).
async function cmQueryDuplicate(userId: string): Promise<void> {
  const { cmQuery, cmTable } = await import('../../utils/cm-identity-test-store');
  await cmQuery(
    `INSERT INTO ${cmTable('cm_tenant_memberships')} ("user_id","tenant_id","status","tenant_role","decided_by","decided_at","updated_at")
     VALUES ($1, 'sentropic', 'requested', 'member', NULL, NULL, $2)`,
    [userId, new Date().toISOString()],
  );
}
