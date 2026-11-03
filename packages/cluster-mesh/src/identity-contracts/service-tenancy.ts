// A4-composition-gaps bundle 1.2.0, domain `service_principal_tenancy` (P3,
// lot G3): the CM-owned S2S on-behalf-of tenant selector. The decision that
// lived in the app's service-tenant adapter moves here; enrollment rows stay
// host-owned control data, read through `ServiceTenantEnrollmentSourceV1`.
// The frozen `TidIssuer` (user, tenant) is untouched — this is a sibling
// issuer for service principals. Refusals are protocol outcomes and are
// returned, never thrown; throws are reserved for contract failures.

import type { IdentityAuditPort, TenantRegistryStore } from './ports.js';
import { systemIdentityClock, type IdentityClock, type ServiceClientBinding } from './types.js';
import { IdentityCustodyErrorV1 } from './custody-errors.js';

/** Registry tenant ids (not slugs) actively enrolled for this client. */
export interface ServiceTenantEnrollmentSourceV1 {
  listEnrolledTenantIds(clientId: string): Promise<readonly string[]>;
}

/**
 * Minimal read surface the issuer needs from the OAuth tenant store. Lot G1's
 * `OAuthTenantStoreV1` (`oauth-reads.ts`) satisfies it structurally; until G1
 * lands, compositions fail closed on stores without the finder.
 */
export interface ServiceTenantBindingSourceV1 {
  findServiceClientBinding(clientId: string): Promise<ServiceClientBinding | null>;
}

export interface ServiceTidClaimV1 {
  readonly tid: string; // tenant slug
  readonly tenantId: string; // registry id
  readonly clientId: string;
  readonly source: 'service_client' | 'connector_enrollment';
  readonly issuedAt: string;
}

export type ServiceTidRefusalReasonV1 =
  | 'no_authorized_tenant'
  | 'tenant_selector_required'
  | 'tenant_not_authorized';

export type ServiceTidOutcomeV1 =
  | { readonly issued: true; readonly claim: ServiceTidClaimV1 }
  | { readonly issued: false; readonly reason: ServiceTidRefusalReasonV1 };

export interface ServicePrincipalTidIssuerV1 {
  issueServiceTid(input: {
    readonly clientId: string;
    readonly requestedTenant: string | null; // tid slug, as on the wire today
  }): Promise<ServiceTidOutcomeV1>;
}

interface AuthorizedTenant {
  readonly tenantId: string;
  readonly tid: string;
  readonly source: 'service_client' | 'connector_enrollment';
}

export function createServicePrincipalTidIssuerV1(input: {
  readonly tenants: TenantRegistryStore;
  readonly oauth: ServiceTenantBindingSourceV1;
  readonly enrollments?: ServiceTenantEnrollmentSourceV1;
  readonly audit?: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): ServicePrincipalTidIssuerV1 {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async issueServiceTid({ clientId, requestedTenant }) {
      if (!clientId) throw new IdentityCustodyErrorV1('identity_material_invalid');
      // Fixed leg: a binding to a missing or non-active tenant contributes
      // nothing — never mint for an unknown tenant.
      const authorized = new Map<string, AuthorizedTenant>();
      const binding = await input.oauth.findServiceClientBinding(clientId);
      if (binding) {
        const tenant = await input.tenants.findTenant(binding.tenantId);
        if (tenant && tenant.status === 'active') {
          authorized.set(tenant.tenantId, { tenantId: tenant.tenantId, tid: tenant.slug, source: 'service_client' });
        }
      }
      // Enrollment leg: CM never trusts the host port's activity filtering;
      // each id is re-read and contributes only when active. A tenant already
      // contributed by the fixed leg keeps the `service_client` source.
      if (input.enrollments) {
        for (const tenantId of await input.enrollments.listEnrolledTenantIds(clientId)) {
          if (authorized.has(tenantId)) continue;
          const tenant = await input.tenants.findTenant(tenantId);
          if (tenant && tenant.status === 'active') {
            authorized.set(tenant.tenantId, { tenantId: tenant.tenantId, tid: tenant.slug, source: 'connector_enrollment' });
          }
        }
      }
      // Decision over the authorized set, compared by tid slug: no implicit
      // tenant, no first-row default, ever.
      const entries = [...authorized.values()];
      const now = clock();
      let outcome: ServiceTidOutcomeV1;
      if (entries.length === 0) {
        outcome = { issued: false, reason: 'no_authorized_tenant' };
      } else if (entries.length === 1) {
        const only = entries[0]!;
        outcome = requestedTenant !== null && requestedTenant !== only.tid
          ? { issued: false, reason: 'tenant_not_authorized' }
          : { issued: true, claim: { tid: only.tid, tenantId: only.tenantId, clientId, source: only.source, issuedAt: now } };
      } else if (requestedTenant === null) {
        outcome = { issued: false, reason: 'tenant_selector_required' };
      } else {
        const match = entries.find((entry) => entry.tid === requestedTenant);
        outcome = match
          ? { issued: true, claim: { tid: match.tid, tenantId: match.tenantId, clientId, source: match.source, issuedAt: now } }
          : { issued: false, reason: 'tenant_not_authorized' };
      }
      if (input.audit) {
        await input.audit.append({
          at: now,
          kind: 's2s_obo_mint',
          actorId: clientId,
          ...(outcome.issued ? { subjectId: outcome.claim.tenantId } : {}),
          detail: outcome.issued ? 'outcome=minted' : `outcome=rejected_${outcome.reason}`,
        });
      }
      return outcome;
    },
  };
}
