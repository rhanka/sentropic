import { describe, it, expect, afterEach } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { tenants, tenantMemberships } from '../../../src/db/schema';
import { createTestUser, cleanupAuthData } from '../../utils/auth-helper';

// BR-39e Lot 1 — tenancy core. Verifies the schema + D5 migration backfill and the
// tenant-isolation invariant (negative A->B). No service layer yet (that is Lot 2);
// these assert the schema/migration directly via the DB.
const TENANT_A = 'tenant-a-test';
const TENANT_B = 'tenant-b-test';

describe('BR-39e tenancy schema (Lot 1)', () => {
  afterEach(async () => {
    // Membership rows reference users (FK cascade) but clean explicitly for clarity,
    // then remove the throwaway test tenants (NOT the seeded `sentropic` tenant).
    await db.delete(tenantMemberships).where(inArray(tenantMemberships.tenantId, [TENANT_A, TENANT_B, 'sentropic']));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
    await cleanupAuthData();
  });

  it('seeds the default `sentropic` tenant via the D5 migration backfill', async () => {
    const [row] = await db.select().from(tenants).where(eq(tenants.id, 'sentropic'));
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
  });

  it('defaults a new membership to status=requested / role=member and enforces (tenant,user) uniqueness', async () => {
    const user = await createTestUser({ email: `tenant-${crypto.randomUUID()}@example.com`, displayName: 'T' });

    await db.insert(tenantMemberships).values({ tenantId: 'sentropic', userId: user.id });
    const [m] = await db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, 'sentropic'), eq(tenantMemberships.userId, user.id)));
    expect(m?.status).toBe('requested');
    expect(m?.role).toBe('member');

    // A duplicate (tenant,user) row is rejected by the unique index.
    await expect(
      db.insert(tenantMemberships).values({ tenantId: 'sentropic', userId: user.id }),
    ).rejects.toThrow();
  });

  it('isolates memberships across tenants (negative A->B)', async () => {
    await db.insert(tenants).values({ id: TENANT_A, name: 'Tenant A' }).onConflictDoNothing();
    await db.insert(tenants).values({ id: TENANT_B, name: 'Tenant B' }).onConflictDoNothing();
    const userA = await createTestUser({ email: `a-${crypto.randomUUID()}@example.com`, displayName: 'A' });
    const userB = await createTestUser({ email: `b-${crypto.randomUUID()}@example.com`, displayName: 'B' });
    await db.insert(tenantMemberships).values({ tenantId: TENANT_A, userId: userA.id, status: 'approved' });
    await db.insert(tenantMemberships).values({ tenantId: TENANT_B, userId: userB.id, status: 'approved' });

    // A query scoped to tenant A must never surface tenant B's member.
    const aMembers = await db.select().from(tenantMemberships).where(eq(tenantMemberships.tenantId, TENANT_A));
    const aUserIds = aMembers.map((row) => row.userId);
    expect(aUserIds).toContain(userA.id);
    expect(aUserIds).not.toContain(userB.id);
  });
});
