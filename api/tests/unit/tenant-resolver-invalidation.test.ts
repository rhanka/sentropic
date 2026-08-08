import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { tenantMemberships, tenants } from '../../src/db/schema';
import { cleanupAuthData, createTestUser } from '../utils/auth-helper';
import { decideMembership } from '../../src/services/auth/tenant-membership';
import { resetResolveTenantCache, resolveTenant } from '../../src/services/tenancy/resolve-tenant';

const tenantId = `tenant-resolver-invalidation-${crypto.randomUUID()}`;

describe('resolveTenant membership invalidation', () => {
  beforeEach(async () => {
    resetResolveTenantCache();
    await db.insert(tenants).values({ id: tenantId, name: tenantId, status: 'active' });
  });

  afterEach(async () => {
    resetResolveTenantCache();
    await db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await cleanupAuthData();
  });

  it('denies a suspended membership after it was previously resolved as approved', async () => {
    const admin = await createTestUser({
      email: `tenant-resolver-admin-${crypto.randomUUID()}@example.com`,
      displayName: 'Tenant Resolver Admin',
    });
    const member = await createTestUser({
      email: `tenant-resolver-member-${crypto.randomUUID()}@example.com`,
      displayName: 'Tenant Resolver Member',
    });
    await db
      .insert(tenantMemberships)
      .values({ tenantId, userId: member.id, status: 'requested', role: 'member' });

    expect(await decideMembership(admin.id, 'admin_app', tenantId, member.id, 'approve')).toEqual({ status: 'approved' });
    expect(await resolveTenant({ userId: member.id })).toEqual({ tenantId });

    expect(await decideMembership(admin.id, 'admin_app', tenantId, member.id, 'suspend')).toEqual({ status: 'suspended' });
    expect(await resolveTenant({ userId: member.id })).toEqual({ error: 'unknown' });
  });
});
