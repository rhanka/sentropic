// P3 (lot G3) binding wiring: when `serviceTenancy` is set on the binding
// input, the binding constructs `ports.serviceTenant` itself from the
// CM-owned issuer over `tx.stores`, ignoring the `fixedTenantId` argument
// auth-hono passes (CM re-reads authority). Setting `serviceTenancy` together
// with `hostPorts.serviceTenant` is refused at construction — two selector
// policies in one composition are never merged. Audit goes through the
// binding's drained audit buffer, preserving the current `s2s_obo_mint`
// record shape; the domain factory's own `audit` port stays unused here (one
// audit channel per composition).

import type { AuthHonoPorts, AuthHonoServiceTenantPort } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { IdentityTransactionV1 } from '../identity-contracts/custody.js';
import {
  createServicePrincipalTidIssuerV1,
  type ServiceTenantBindingSourceV1,
  type ServiceTidRefusalReasonV1,
} from '../identity-contracts/service-tenancy.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

const REFUSAL_DESCRIPTIONS: Readonly<Record<ServiceTidRefusalReasonV1, string>> = {
  no_authorized_tenant: 'The client has no authorized tenant to act on behalf of.',
  tenant_selector_required: 'A tenant selector is required for a multi-tenant service client.',
  tenant_not_authorized: 'Requested tenant is not authorized for this client.',
};

/**
 * Capability check for the G1 read surface on `tx.stores.oauth`; fails closed
 * with `identity_contract_unavailable` on pre-G1 stores. Once lot G1 lands,
 * this is `oauthTenantStoreV1(tx)` (the stack absorbs G1 on rebase).
 */
const serviceBindingReads = <H>(tx: IdentityTransactionV1<H>): ServiceTenantBindingSourceV1 => {
  const oauth = tx.stores.oauth as Partial<ServiceTenantBindingSourceV1>;
  if (typeof oauth.findServiceClientBinding !== 'function') {
    throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  }
  return oauth as ServiceTenantBindingSourceV1;
};

export const authServiceTenantPort = <H>(
  input: IdentityAuthBindingInput<H>,
  auditLog: AuthHonoPorts['auditLog'],
  check: () => void,
): AuthHonoServiceTenantPort | undefined => {
  const config = input.serviceTenancy;
  if (!config) return undefined;
  if (input.hostPorts.serviceTenant) throw new IdentityCustodyErrorV1('identity_material_invalid');
  const issuer = createServicePrincipalTidIssuerV1({
    tenants: input.tx.stores.tenants,
    oauth: serviceBindingReads(input.tx),
    enrollments: config.enrollments,
    clock: () => input.hostPorts.clock.now().toISOString(),
  });
  return {
    resolveOboTenant: async ({ clientId, requestedTenant }) => {
      check();
      const outcome = await issuer.issueServiceTid({ clientId, requestedTenant });
      if (outcome.issued) {
        auditLog.record('info', 's2s_obo_mint', { clientId, requestedTenant: requestedTenant ?? null, resolvedTid: outcome.claim.tid, outcome: 'minted' });
        return { tid: outcome.claim.tid };
      }
      auditLog.record('info', 's2s_obo_mint', { clientId, requestedTenant: requestedTenant ?? null, resolvedTid: null, outcome: 'rejected_invalid_target' });
      return { error: 'invalid_target', description: REFUSAL_DESCRIPTIONS[outcome.reason] };
    },
  };
};
