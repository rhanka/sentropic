import type { AuthHonoServiceTenantPort } from '@sentropic/auth-hono';

import { logger } from '../../logger';
import { activeEnrollmentTenantsForPrincipal } from '../tenancy/enrollment-store';

/**
 * ARCH-11 G1c — the Sentropic host policy for the S2S on-behalf-of (OBO) tenant mint (spec §2.2).
 *
 * Lot A4: always STRICT (TENANT_RESOLUTION_MODE is removed — tenant resolution is
 * authoritative in the cluster mesh; the fixed binding lives in
 * cm_identity.cm_service_clients and is supplied as `fixedTenantId`). The requested
 * tenant is validated fail-closed against the client's authorized set — the fixed
 * `cm_service_clients.tenant_id` UNION its active `connector_tenant_enrollments` rows:
 *   * set size 0  → `invalid_target` (no tenant to bind — fail closed).
 *   * single-org  → omitted binds the fixed tenant; a supplied value must equal it, else `invalid_target`.
 *   * multi-org   → `tenant` is MANDATORY (absent → `invalid_target`, no default); out-of-set → `invalid_target`.
 *
 * Every mint decision is audited `{ client_id, requested_tenant, resolved_tid, outcome }` — the
 * stateless token leaves the audit log as the only forensic record (rollback quarantine, §4.4).
 */
export const createServiceTenantAdapter = (): AuthHonoServiceTenantPort => ({
  async resolveOboTenant({ clientId, fixedTenantId, requestedTenant }) {
    const enrolled = await activeEnrollmentTenantsForPrincipal(clientId);
    const authorized = new Set(enrolled);
    if (fixedTenantId) authorized.add(fixedTenantId);

    const audit = (outcome: string, resolvedTid: string | null): void => {
      logger.info(
        {
          audit: 's2s_obo_mint',
          clientId,
          requestedTenant: requestedTenant ?? null,
          resolvedTid,
          outcome,
        },
        's2s_obo_mint',
      );
    };

    const reject = (description: string): { error: 'invalid_target'; description: string } => {
      audit('rejected_invalid_target', null);
      return { error: 'invalid_target', description };
    };

    // No tenant at all → cannot bind a tid (fail closed).
    if (authorized.size === 0) {
      return reject('The client has no authorized tenant to act on behalf of.');
    }

    // Single-org: omitted binds the fixed tenant; a supplied value must equal the only authorized one.
    if (authorized.size === 1) {
      const only = [...authorized][0]!;
      if (requestedTenant !== null && requestedTenant !== only) {
        return reject('Requested tenant is not authorized for this client.');
      }
      audit('minted', only);
      return { tid: only };
    }

    // Multi-org: `tenant` is mandatory and must be in the authorized set (no default — fail closed).
    if (requestedTenant === null) {
      return reject('A tenant selector is required for a multi-tenant service client.');
    }
    if (!authorized.has(requestedTenant)) {
      return reject('Requested tenant is not authorized for this client.');
    }
    audit('minted', requestedTenant);
    return { tid: requestedTenant };
  },
});
