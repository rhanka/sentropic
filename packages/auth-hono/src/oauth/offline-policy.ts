import type { AuthHonoConsentGrant, AuthHonoPorts } from '../ports.js';
import type { OauthClientRecord } from './state-store-types.js';

export const isRefreshEligibleClient = (client: OauthClientRecord): boolean =>
  client.grantTypes.includes('authorization_code') && client.grantTypes.includes('refresh_token') &&
  client.allowedScopes.includes('offline_access') &&
  client.requiredAcr == null;

export const hasOfflineCoverage = (grant: AuthHonoConsentGrant | null, input: {
  issuer: string; scope: string; resource: string | null; offlineGrantId?: string;
}): boolean => {
  if (!grant?.offlineGrantId || !grant.offlineConsentedAt || grant.offlineIssuer !== input.issuer ||
      (input.offlineGrantId !== undefined && grant.offlineGrantId !== input.offlineGrantId)) return false;
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  return scopes.includes('offline_access') && scopes.every((scope) =>
    grant.scopes.includes(scope) && grant.offlineScopes?.includes(scope)) &&
    (input.resource === null ? grant.defaultAudienceApproved === true :
      grant.approvedResources?.includes(input.resource) === true);
};

export interface OfflineAuthority {
  clientId: string; userId: string; tenantId: string | null; scope: string;
  offlineGrantId?: string; issuer?: string; audience?: string; resource?: string | null;
  dpopJkt: string | null;
}

/** Caller holds the client guard, user row and (when present) family anchor. */
export const isCurrentOfflineGrantAuthorized = async (ports: AuthHonoPorts,
  client: OauthClientRecord, sealed: OfflineAuthority, issuer: string, userinfoAudience: string,
): Promise<boolean> => {
  if (!isRefreshEligibleClient(client) || sealed.issuer !== issuer || !sealed.offlineGrantId ||
      sealed.clientId !== client.clientId ||
      sealed.scope.split(/\s+/).some((scope) => !client.allowedScopes.includes(scope)) ||
      (client.allowedUserIds?.length && !client.allowedUserIds.includes(sealed.userId)) ||
      (client.dpopBoundAccessTokens && !sealed.dpopJkt)) return false;
  if (sealed.resource ? !client.resourceIndicators?.includes(sealed.resource) || sealed.audience !== sealed.resource :
    sealed.audience !== userinfoAudience) return false;
  const user = await ports.users.findById(sealed.userId);
  if (!user || !(await ports.accountPolicy.canAuthenticate(user, ports.clock.now())).allowed) return false;
  if (sealed.tenantId && (!ports.tenant ||
      !(await ports.tenant.isApprovedMember(sealed.userId, sealed.tenantId)))) return false;
  const grant = await ports.consentStore?.getGrant(sealed.userId, sealed.clientId, sealed.tenantId ?? undefined);
  return hasOfflineCoverage(grant ?? null, {
    issuer, offlineGrantId: sealed.offlineGrantId, scope: sealed.scope, resource: sealed.resource ?? null,
  });
};
