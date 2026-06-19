import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { appendParams, redirectOrJson } from './http-utils.js';
import type { OAuthContinuationState } from './state-codec.js';

export interface IssueAuthorizedCodeOptions {
  authorizationCodeTtlSeconds?: number;
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
  const code = options.ports.random.token(32);
  const now = options.ports.clock.now();
  await options.ports.oauthStateStore.saveAuthCode(
    code,
    {
      acr: payload.acr ?? 'urn:sentropic:loa:bearer',
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
    appendParams(payload.redirectUri, { code, state: payload.state }, c.req.url)
  );
};
