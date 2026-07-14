/**
 * ARCH-11 G1c — DB-backed authorized-tenant-set resolver (spec §2.1).
 *
 * Reads `control.connector_tenant_enrollments` (the soft-ref control table G1c adds) to answer
 * "which real tenant(s) may this principal act on behalf of?". This is the durable backing the
 * default in-memory `InMemoryTenantRegistry` (`mcp-platform` `authz.ts:245`) lacks; wiring THIS
 * resolver into `mcp-platform` is the MCP lane's BR-42l territory (see BRANCH.md `BR-G1c-EX1`) —
 * G1c ships the table + this api-side resolver + the S2S OBO mint that consumes it.
 *
 * §1.6 fix (Codex-found): a SINGLE-ORG client resolves its fixed `service_clients.tenant_id`
 * WITHOUT an enrollment row — `authorizedTenants` UNIONs that fixed tenant. Enrollment rows exist
 * ONLY for multi-org sets. An empty result stays fail-closed at the caller (never a wildcard).
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { connectorTenantEnrollments } from '../../db/control-schema';
import { serviceClients } from '../../db/schema';

/** Active enrollment tenant_ids for a principal on ONE connector instance (no fixed-tenant union). */
async function activeEnrollmentTenantsForConnector(
  principalSub: string,
  connectorInstanceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ tenantId: connectorTenantEnrollments.tenantId })
    .from(connectorTenantEnrollments)
    .where(
      and(
        eq(connectorTenantEnrollments.principalSub, principalSub),
        eq(connectorTenantEnrollments.connectorInstanceId, connectorInstanceId),
        eq(connectorTenantEnrollments.status, 'active'),
      ),
    );
  return rows.map((row) => row.tenantId);
}

/**
 * Active enrollment tenant_ids for a principal across ALL connector instances. Used by the S2S OBO
 * mint (§2.2), which validates a `tenant` on-behalf-of selector at the token endpoint — where there
 * is no single connector instance in scope (the finer per-connector check is `mcp-platform`'s job).
 */
export async function activeEnrollmentTenantsForPrincipal(principalSub: string): Promise<string[]> {
  const rows = await db
    .select({ tenantId: connectorTenantEnrollments.tenantId })
    .from(connectorTenantEnrollments)
    .where(
      and(
        eq(connectorTenantEnrollments.principalSub, principalSub),
        eq(connectorTenantEnrollments.status, 'active'),
      ),
    );
  return rows.map((row) => row.tenantId);
}

/** The fixed S2S tenant of a service client (`service_clients.tenant_id`), or null when absent/unknown. */
async function fixedServiceClientTenant(clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: serviceClients.tenantId })
    .from(serviceClients)
    .where(eq(serviceClients.clientId, clientId))
    .limit(1);
  return row?.tenantId ?? null;
}

/**
 * The authorized tenant set for a principal on a connector instance (spec §2.1). Returns the
 * active enrollment rows for that connector UNION the principal's fixed `service_clients.tenant_id`
 * (as a singleton) so a single-org client resolves WITHOUT an enrollment row (§1.6 fix). Deduped.
 * An empty result is the fail-closed `no_enrollment` signal for the caller.
 */
export async function authorizedTenants(
  principalSub: string,
  connectorInstanceId: string,
): Promise<string[]> {
  const [enrolled, fixed] = await Promise.all([
    activeEnrollmentTenantsForConnector(principalSub, connectorInstanceId),
    fixedServiceClientTenant(principalSub),
  ]);
  const set = new Set(enrolled);
  if (fixed) set.add(fixed);
  return [...set];
}
