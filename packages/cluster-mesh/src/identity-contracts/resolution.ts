// Identity core contracts: tenant resolution with switch-over modes (F12)
// and tid issuance with tenant-scoped OAuth legs (F13).
// Steady state is authoritative resolution only; alias/shadow are transition
// tooling with a deletion date in the lot plan, never permanent semantics.

import { TenantBoundaryError } from '../errors.js';
import { IdentityNotFoundError, TenantNotActiveError } from './errors.js';
import type {
  DivergenceMetricsPort,
  OAuthTenantStore,
  TenantMembershipStore,
  TenantRegistryStore,
  WorkspaceDirectoryStore,
} from './ports.js';
import {
  systemIdentityClock,
  type AuthoritativeResolution,
  type IdentityClock,
  type OAuthConsentRecord,
  type ServiceClientBinding,
  type ShadowComparison,
  type TenantResolutionMode,
  type TidClaim,
} from './types.js';

export interface TenantResolver {
  resolveAuthoritatively(input: { readonly workspaceId: string; readonly userId: string }): Promise<AuthoritativeResolution>;
  resolveWithMode(
    input: { readonly workspaceId: string; readonly userId: string },
    mode: TenantResolutionMode,
    options: { readonly legacyResolve: (input: { readonly workspaceId: string; readonly userId: string }) => Promise<string> },
  ): Promise<AuthoritativeResolution | { readonly tid: string; readonly mode: 'alias' } | ShadowComparison>;
}

export function createTenantResolver(input: {
  readonly workspaces: WorkspaceDirectoryStore;
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly metrics: DivergenceMetricsPort;
  readonly clock?: IdentityClock;
}): TenantResolver {
  const clock = input.clock ?? systemIdentityClock;
  async function authoritative(lookup: { workspaceId: string; userId: string }): Promise<AuthoritativeResolution> {
    const workspace = await input.workspaces.findWorkspace(lookup.workspaceId);
    if (!workspace) throw new TenantBoundaryError();
    const tenant = await input.tenants.findTenant(workspace.tenantId);
    if (!tenant || tenant.status !== 'active') throw new TenantBoundaryError();
    const membership = await input.memberships.findApprovedMembership(lookup.userId, workspace.tenantId);
    if (!membership || membership.status !== 'approved' || membership.userId !== lookup.userId) {
      throw new TenantBoundaryError();
    }
    return {
      tid: tenant.slug,
      tenantId: tenant.tenantId,
      workspaceId: lookup.workspaceId,
      userId: lookup.userId,
      membershipRevision: membership.updatedAt,
    };
  }
  return {
    resolveAuthoritatively: authoritative,
    async resolveWithMode(lookup, mode, options) {
      if (mode === 'strict') return authoritative(lookup);
      if (mode === 'alias') return { tid: await options.legacyResolve(lookup), mode: 'alias' as const };
      let resolved: AuthoritativeResolution | null = null;
      try {
        resolved = await authoritative(lookup);
      } catch (error) {
        if (!(error instanceof TenantBoundaryError)) throw error;
      }
      const legacyTid = await options.legacyResolve(lookup);
      const diverged = resolved === null || resolved.tid !== legacyTid;
      input.metrics.record({ workspaceId: lookup.workspaceId, userId: lookup.userId, diverged, at: clock() });
      return { mode: 'shadow', authoritative: resolved, legacyTid, diverged };
    },
  };
}

export interface TidIssuer {
  issueTid(input: { readonly userId: string; readonly tenantId: string }, now: string): Promise<TidClaim>;
}

export function createTidIssuer(input: {
  readonly memberships: TenantMembershipStore;
  readonly tenants: TenantRegistryStore;
}): TidIssuer {
  return {
    async issueTid(claim, now) {
      const tenant = await input.tenants.findTenant(claim.tenantId);
      if (!tenant) throw new IdentityNotFoundError('tenant', claim.tenantId);
      const membership = await input.memberships.findApprovedMembership(claim.userId, claim.tenantId);
      if (!membership || membership.status !== 'approved') throw new TenantBoundaryError();
      if (tenant.status !== 'active') throw new TenantNotActiveError(claim.tenantId);
      return { tid: tenant.slug, tenantId: tenant.tenantId, userId: claim.userId, issuedAt: now };
    },
  };
}

export interface TenantOAuthDomain {
  grantConsent(input: {
    readonly consentId: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly clientId: string;
  }): Promise<OAuthConsentRecord>;
  revokeConsent(consentId: string, actorId: string): Promise<boolean>;
  bindServiceClient(input: { readonly clientId: string; readonly tenantId: string }): Promise<ServiceClientBinding>;
  listTenantOAuthClients(tenantId: string): Promise<readonly ServiceClientBinding[]>;
}

export function createTenantOAuth(input: {
  readonly oauth: OAuthTenantStore;
  readonly clock?: IdentityClock;
}): TenantOAuthDomain {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async grantConsent(consent) {
      const record: OAuthConsentRecord = { ...consent, grantedAt: clock() };
      await input.oauth.grantConsent(record);
      return record;
    },
    async revokeConsent(consentId, _actorId) {
      return input.oauth.revokeConsent(consentId, clock());
    },
    async bindServiceClient(binding) {
      const record: ServiceClientBinding = { ...binding, boundAt: clock() };
      await input.oauth.bindServiceClient(record);
      return record;
    },
    async listTenantOAuthClients(tenantId) {
      return input.oauth.listTenantServiceClients(tenantId);
    },
  };
}
