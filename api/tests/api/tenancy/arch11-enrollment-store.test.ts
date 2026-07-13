import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { connectorTenantEnrollments } from '../../../src/db/control-schema';
import { serviceClients, tenants } from '../../../src/db/schema';
import {
  activeEnrollmentTenantsForPrincipal,
  authorizedTenants,
} from '../../../src/services/tenancy/enrollment-store';

// ARCH-11 G1c — DB-backed authorized-tenant-set resolver (spec §2.1). Proves: a single-org client
// resolves its FIXED service_clients.tenant_id WITHOUT an enrollment row (§1.6 fix); active rows are
// included and suspended rows excluded; a NON-VACUOUS ≥2-org set; and per-connector scoping.

const ORG_A = 'arch11g1c-es-org-a';
const ORG_B = 'arch11g1c-es-org-b';
const ORG_C = 'arch11g1c-es-org-c';
const TEST_ORGS = [ORG_A, ORG_B, ORG_C];

const SINGLE_ORG_CLIENT = 'arch11g1c-es-single';
const MULTI_ORG_CLIENT = 'arch11g1c-es-multi';
const TEST_CLIENTS = [SINGLE_ORG_CLIENT, MULTI_ORG_CLIENT];

const CONNECTOR_1 = 'arch11g1c-es-connector-1';
const CONNECTOR_2 = 'arch11g1c-es-connector-2';

async function seedOrg(id: string): Promise<void> {
  await db.insert(tenants).values({ id, name: id, status: 'active' }).onConflictDoNothing();
}

async function seedServiceClient(clientId: string, tenantId: string | null): Promise<void> {
  await db
    .insert(serviceClients)
    .values({
      id: `svc-${clientId}`,
      clientId,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
      tenantId,
    })
    .onConflictDoNothing();
}

async function seedEnrollment(
  principalSub: string,
  connectorInstanceId: string,
  tenantId: string,
  status = 'active',
): Promise<void> {
  await db
    .insert(connectorTenantEnrollments)
    .values({ principalSub, connectorInstanceId, tenantId, status })
    .onConflictDoNothing();
}

describe('ARCH-11 G1c — enrollment-store authorizedTenants resolver', () => {
  beforeEach(async () => {
    for (const org of TEST_ORGS) await seedOrg(org);
  });

  afterEach(async () => {
    await db
      .delete(connectorTenantEnrollments)
      .where(inArray(connectorTenantEnrollments.principalSub, TEST_CLIENTS));
    await db.delete(serviceClients).where(inArray(serviceClients.clientId, TEST_CLIENTS));
    await db.delete(tenants).where(inArray(tenants.id, TEST_ORGS));
  });

  it('single-org client resolves its FIXED tenant WITHOUT an enrollment row (§1.6 fix)', async () => {
    await seedServiceClient(SINGLE_ORG_CLIENT, ORG_A);

    // No enrollment rows exist for this client; the fixed service_clients.tenant_id is unioned in.
    expect(await authorizedTenants(SINGLE_ORG_CLIENT, CONNECTOR_1)).toEqual([ORG_A]);
  });

  it('includes ACTIVE enrollment rows and EXCLUDES suspended rows', async () => {
    await seedServiceClient(MULTI_ORG_CLIENT, ORG_A);
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_1, ORG_B, 'active');
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_1, ORG_C, 'suspended');

    const set = await authorizedTenants(MULTI_ORG_CLIENT, CONNECTOR_1);
    expect(new Set(set)).toEqual(new Set([ORG_A, ORG_B])); // fixed A + active B; suspended C excluded
    expect(set).not.toContain(ORG_C);
  });

  it('NON-VACUOUS ≥2-org: fixed org-A + enrolled org-B → {A,B}, org-C never leaks', async () => {
    await seedServiceClient(MULTI_ORG_CLIENT, ORG_A);
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_1, ORG_B, 'active');

    const set = new Set(await authorizedTenants(MULTI_ORG_CLIENT, CONNECTOR_1));
    expect(set).toEqual(new Set([ORG_A, ORG_B]));
    expect(set.has(ORG_C)).toBe(false);

    // Client-level (all connectors) mint view: A (fixed) is NOT here (enrollment-only), B is.
    expect(await activeEnrollmentTenantsForPrincipal(MULTI_ORG_CLIENT)).toEqual([ORG_B]);
  });

  it('per-connector scoping: an enrollment on connector-1 is not seen on connector-2', async () => {
    await seedServiceClient(MULTI_ORG_CLIENT, ORG_A);
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_1, ORG_B, 'active');

    // connector-2 sees only the fixed tenant (no enrollment row on it).
    expect(await authorizedTenants(MULTI_ORG_CLIENT, CONNECTOR_2)).toEqual([ORG_A]);
    // connector-1 sees fixed A + enrolled B.
    expect(new Set(await authorizedTenants(MULTI_ORG_CLIENT, CONNECTOR_1))).toEqual(
      new Set([ORG_A, ORG_B]),
    );
  });

  it('a client with NO fixed tenant and NO enrollment resolves the empty (fail-closed) set', async () => {
    await seedServiceClient(SINGLE_ORG_CLIENT, null);

    expect(await authorizedTenants(SINGLE_ORG_CLIENT, CONNECTOR_1)).toEqual([]);
  });

  it('activeEnrollmentTenantsForPrincipal spans connectors and excludes suspended', async () => {
    await seedServiceClient(MULTI_ORG_CLIENT, ORG_A);
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_1, ORG_B, 'active');
    await seedEnrollment(MULTI_ORG_CLIENT, CONNECTOR_2, ORG_C, 'active');
    // A suspended duplicate must not add ORG_B twice / must not surface.
    await db
      .insert(connectorTenantEnrollments)
      .values({
        principalSub: MULTI_ORG_CLIENT,
        connectorInstanceId: CONNECTOR_2,
        tenantId: ORG_B,
        status: 'suspended',
      })
      .onConflictDoNothing();

    const set = new Set(await activeEnrollmentTenantsForPrincipal(MULTI_ORG_CLIENT));
    expect(set).toEqual(new Set([ORG_B, ORG_C]));

    // Sanity: the suspended (connector-2, ORG_B) row exists but is filtered out.
    const suspended = await db
      .select({ status: connectorTenantEnrollments.status })
      .from(connectorTenantEnrollments)
      .where(
        and(
          eq(connectorTenantEnrollments.principalSub, MULTI_ORG_CLIENT),
          eq(connectorTenantEnrollments.connectorInstanceId, CONNECTOR_2),
          eq(connectorTenantEnrollments.tenantId, ORG_B),
        ),
      );
    expect(suspended[0]?.status).toBe('suspended');
  });
});
