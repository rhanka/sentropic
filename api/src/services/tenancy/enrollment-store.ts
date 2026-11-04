/**
 * ARCH-11 G1c — DB-backed authorized-tenant-set resolver (spec §2.1).
 *
 * Reads `control.connector_tenant_enrollments` (the soft-ref control table G1c adds) to answer
 * "which real tenant(s) may this principal act on behalf of?". This is the durable backing the
 * default in-memory `InMemoryTenantRegistry` (`mcp-platform` `authz.ts:245`) lacks; wiring THIS
 * resolver into `mcp-platform` is the MCP lane's BR-42l territory (see BRANCH.md `BR-G1c-EX1`) —
 * G1c ships the table + this api-side resolver + the S2S OBO mint that consumes it.
 *
 * A single-org client's fixed binding comes from CM. Enrollment rows extend that set;
 * inactive CM tenants never confer authority. All reads share one snapshot.
 */
import { and, eq } from 'drizzle-orm';
import type { ServiceTenantEnrollmentSourceV1 } from '@sentropic/cluster-mesh';

import { connectorTenantEnrollments } from '../../db/control-schema';
import { requireCmOAuthTransaction } from '../identity/cm-oauth-tenancy';
import { bindCmAppDatabase, runCmIdentityRead, type CmIdentityTransaction } from '../identity/cm-transaction';
import { findCmServiceClientTenant } from '../identity/cm-service-clients';

/** Active enrollment tenant_ids for a principal on ONE connector instance (no fixed-tenant union). */
async function activeEnrollmentTenantsForConnector(
  principalSub: string,
  connectorInstanceId: string,
): Promise<string[]> {
  return runCmIdentityRead(async tx => {
    const rows = await bindCmAppDatabase(tx)
      .select({ tenantId: connectorTenantEnrollments.tenantId })
      .from(connectorTenantEnrollments)
      .where(and(
        eq(connectorTenantEnrollments.principalSub, principalSub),
        eq(connectorTenantEnrollments.connectorInstanceId, connectorInstanceId),
        eq(connectorTenantEnrollments.status, 'active'),
      ));
    return activeTenantSlugs(rows.map(row => row.tenantId));
  });
}

/**
 * Attempt-scoped enrollment source for the CM-owned S2S OBO selector
 * (a4-cm-gaps-r2 §7.2). The closure captures the binding attempt's
 * transaction: CM re-reads each id and keeps only active tenants, so the
 * source returns registry ids (not slugs) with no activity filtering of its
 * own. Reusing the source after its attempt ended refuses
 * `identity_transaction_unbound` — a reused handle is an app composition
 * bug and must never read enrollments on a foreign or expired handle.
 */
export const createServiceTenantEnrollmentSource = (
  transaction: CmIdentityTransaction,
): ServiceTenantEnrollmentSourceV1 => ({
  async listEnrolledTenantIds(clientId) {
    const tx = requireCmOAuthTransaction(transaction);
    const rows = await bindCmAppDatabase(tx)
      .select({ tenantId: connectorTenantEnrollments.tenantId })
      .from(connectorTenantEnrollments)
      .where(and(
        eq(connectorTenantEnrollments.principalSub, clientId),
        eq(connectorTenantEnrollments.status, 'active'),
      ));
    return [...new Set(rows.map(row => row.tenantId))];
  },
});

const activeTenantSlugs = (ids: string[]) => runCmIdentityRead(async tx => {
  const slugs: string[] = [];
  for (const id of new Set(ids)) {
    const tenant = await tx.stores.tenants.findTenant(id);
    if (tenant?.status === 'active') slugs.push(tenant.slug);
  }
  return slugs;
});

/**
 * The authorized tenant set for a principal on a connector instance (spec §2.1). Returns the
 * active enrollment rows for that connector UNION the principal's CM service-client binding
 * (as a singleton) so a single-org client resolves WITHOUT an enrollment row (§1.6 fix). Deduped.
 * An empty result is the fail-closed `no_enrollment` signal for the caller.
 */
export async function authorizedTenants(
  principalSub: string,
  connectorInstanceId: string,
): Promise<string[]> {
  return runCmIdentityRead(async () => {
    const enrolled = await activeEnrollmentTenantsForConnector(principalSub, connectorInstanceId);
    const fixed = await findCmServiceClientTenant(principalSub);
    const set = new Set(enrolled);
    if (fixed) set.add(fixed);
    return [...set];
  });
}
