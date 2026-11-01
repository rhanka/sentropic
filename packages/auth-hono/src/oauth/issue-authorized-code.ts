import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { appendParams, redirectOrJson, oauthJsonError } from './http-utils.js';
import { hasOfflineCoverage } from './offline-policy.js';
import type { OAuthContinuationState } from './state-codec.js';

export interface IssueAuthorizedCodeOptions {
  offlineTransaction?: boolean;
  authorizationCodeTtlSeconds?: number;
  /** RFC 9207 authorization-server issuer identifier, echoed as `iss` on the success response. */
  issuer: string;
  ports: AuthHonoPorts;
}

/**
 * Single source of truth for issuing an authorization code: mint a single-use code,
 * persist its sealed payload, and redirect (or JSON) back to the RP `redirect_uri` with
 * `code` + `state`. Called by BOTH the consent-approve path and the authorize skip-path
 * (FL-1: never duplicate the seal / single-use-code / redirect logic).
 */
export const issueAuthorizedCode = async (
  c: Context,
  options: IssueAuthorizedCodeOptions,
  payload: OAuthContinuationState
): Promise<Response> => {
  if (payload.scope.split(/\s+/).includes('offline_access') && !options.offlineTransaction) {
    if (!options.ports.oauthRefresh || !payload.userId) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Transactional offline authorization is required.');
    }
    return options.ports.oauthRefresh.transaction({ clientId: payload.clientId, userId: payload.userId },
      async (ports) => issueAuthorizedCode(c, { ...options, ports, offlineTransaction: true }, payload));
  }
  const code = options.ports.random.token(32);
  const now = options.ports.clock.now();
  const offline = payload.scope.split(/\s+/).includes('offline_access');
  const grant = offline && payload.userId ? await options.ports.consentStore?.getGrant(
    payload.userId, payload.clientId, payload.tenantId ?? undefined) : null;
  if (offline && !hasOfflineCoverage(grant ?? null,
    { issuer: options.issuer, resource: payload.resource ?? null, scope: payload.scope })) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Local offline consent is required.');
  }
  const userinfoPath = new URL(c.req.url).pathname.replace(/\/(?:authorize|consent\/decision)$/u, '/userinfo');
  await options.ports.oauthStateStore.saveAuthCode(
    code,
    {
      acr: payload.acr ?? 'urn:sentropic:loa:bearer',
      sessionId: payload.sessionId,
      ...(offline ? { offlineGrantId: grant!.offlineGrantId!, issuer: options.issuer,
        audience: payload.resource ?? `${options.issuer}${userinfoPath}` } : {}),
      amr: payload.amr ?? (payload.acr === 'urn:sentropic:loa:passkey-fresh' ? ['hwk', 'user', 'mfa'] : ['pwd']),
      authTime: new Date(payload.authTime ?? now.toISOString()),
      clientId: payload.clientId,
      codeChallenge: payload.codeChallenge,
      codeChallengeMethod: 'S256',
      createdAt: now,
      dpopJkt: payload.dpopJkt,
      expiresAt: options.ports.clock.addSeconds(now, options.authorizationCodeTtlSeconds ?? 60),
      nonce: payload.nonce,
      redirectUri: payload.redirectUri,
      resource: payload.resource ?? null,
      scope: payload.scope,
      tenantId: payload.tenantId,
      userId: payload.userId ?? '',
    },
    options.authorizationCodeTtlSeconds ?? 60
  );

  return redirectOrJson(
    c,
    // RFC 9207: echo the AS issuer as `iss` on the success authorization response.
    appendParams(payload.redirectUri, { code, iss: options.issuer, state: payload.state }, c.req.url)
  );
};
