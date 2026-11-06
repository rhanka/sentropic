import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

import { createServicePrincipalTidIssuerV1, oauthTenantStoreV1 } from '@sentropic/cluster-mesh';

import { db } from '../../../src/db/client';
import { connectorTenantEnrollments } from '../../../src/db/control-schema';
import { serviceClients } from '../../../src/db/schema';
import { createCmTenant } from '../../../src/services/identity/cm-tenancy';
import { runCmIdentityRead, runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { cmDeleteTenants, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import {
  authorizedTenants,
  createServiceTenantEnrollmentSource,
} from '../../../src/services/tenancy/enrollment-store';

// ARCH-11 G1c — DB-backed authorized-tenant-set resolver (spec §2.1). Proves: a single-org client
// resolves its FIXED service_clients.tenant_id WITHOUT an enrollment row (§1.6 fix); active rows are
// included and suspended rows excluded; a NON-VACUOUS ≥2-org set; and per-connector scoping.
// Client-level (cross-connector) enrollment views go through the CM-owned S2S OBO selector
// (`createServicePrincipalTidIssuerV1`) fed by the attempt-scoped enrollment source — the app-side
// `activeEnrollmentTenantsForPrincipal` selector is deleted (a4-cm-gaps-r2 §10.7 series 3).

const ORG_A = 'arch11g1c-es-org-a';
const ORG_B = 'arch11g1c-es-org-b';
const ORG_C = 'arch11g1c-es-org-c';
const TEST_ORGS = [ORG_A, ORG_B, ORG_C];

const SINGLE_ORG_CLIENT = 'arch11g1c-es-single';
const MULTI_ORG_CLIENT = 'arch11g1c-es-multi';
const TEST_CLIENTS = [SINGLE_ORG_CLIENT, MULTI_ORG_CLIENT];

const CONNECTOR_1 = 'arch11g1c-es-connector-1';
const CONNECTOR_2 = 'arch11g1c-es-connector-2';

/** Client-level enrollment ids through the attempt-scoped CM-owned source (registry ids, all connectors). */
const enrolledTenantIdsForClient = (clientId: string): Promise<readonly string[]> =>
  runCmIdentityRead(async tx => createServiceTenantEnrollmentSource(tx).listEnrolledTenantIds(clientId));

/** Mint view through the CM-owned S2S OBO selector (fixed leg + enrollment leg, CM re-reads activity). */
const mintForClient = (clientId: string, requestedTenant: string | null) =>
  runCmIdentityRead(async tx => createServicePrincipalTidIssuerV1({
    tenants: tx.stores.tenants,
    oauth: oauthTenantStoreV1(tx),
    enrollments: createServiceTenantEnrollmentSource(tx),
  }).issueServiceTid({ clientId, requestedTenant }));

async function seedOrg(id: string): Promise<void> {
  await createCmTenant({ tenantId: id, slug: id, status: 'active' }).catch(() => {});
}

async function seedServiceClient(clientId: string, tenantId: string | null): Promise<void> {
  await db
    .insert(serviceClients)
    .values({
      id: `svc-${clientId}`,
      clientId,
      clientSecretHash: 'hash',
      allowedScopes: ['mcp:read'],
    })
    .onConflictDoNothing();
  if (tenantId) await runCmIdentityWrite(transaction => transaction.stores.oauth.bindServiceClient({
    clientId, tenantId, boundAt: new Date().toISOString(),
  }));
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
    await cmQuery(`DELETE FROM ${cmTable('cm_service_clients')} WHERE client_id = ANY($1)`, [TEST_CLIENTS]);
    await cmDeleteTenants(TEST_ORGS);
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

    // Client-level (all connectors) enrollment view: A (fixed) is NOT here (enrollment-only), B is.
    expect([...await enrolledTenantIdsForClient(MULTI_ORG_CLIENT)].sort()).toEqual([ORG_B]);
    // The CM-owned mint over the same legs issues B from the enrollment leg, and refuses
    // the implicit (selector-less) mint on the 2-tenant set.
    expect(await mintForClient(MULTI_ORG_CLIENT, ORG_B)).toMatchObject({ issued: true,
      claim: { tid: ORG_B, tenantId: ORG_B, clientId: MULTI_ORG_CLIENT, source: 'connector_enrollment' } });
    expect(await mintForClient(MULTI_ORG_CLIENT, null)).toEqual({ issued: false,
      reason: 'tenant_selector_required' });
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

  it('service-tenant enrollment source spans connectors and excludes suspended', async () => {
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

    const set = new Set(await enrolledTenantIdsForClient(MULTI_ORG_CLIENT));
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
