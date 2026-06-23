import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import type { OauthClientRecord } from './state-store-types.js';
import type { OAuthContinuationCodec, OAuthContinuationState } from './state-codec.js';
import { appendParams, oauthJsonError, redirectWithOAuthError } from './http-utils.js';
import { issueAuthorizedCode } from './issue-authorized-code.js';
import { validateRedirectUri } from './redirect-utils.js';
import { resolveOAuthAcr, resolveOAuthSession } from './session-resolver.js';

export interface OAuthAuthorizeHandlerOptions {
  authorizationCodeTtlSeconds?: number;
  consentUrl: string;
  issuer: string;
  loginUrl: string;
  ports: AuthHonoPorts;
  stateCodec: OAuthContinuationCodec;
  stateTtlSeconds?: number;
}

interface ValidatedAuthorizeRequest {
  client: OauthClientRecord;
  codeChallenge: string;
  dpopJkt: string | null;
  nonce: string | null;
  redirectUri: string;
  resource: string | null;
  scope: string;
  state: string | null;
}

export const createOAuthAuthorizeHandler =
  (options: OAuthAuthorizeHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const continuation = c.req.query('continue');
    if (continuation) {
      return resumeLoginContinuation(c, options, continuation);
    }

    const validation = await validateAuthorizeRequest(c, options.ports);
    if (validation instanceof Response) return validation;

    const prompt = c.req.query('prompt') ?? '';
    const session = await resolveOAuthSession(c.req.raw, options.ports);

    if (!session || prompt === 'login') {
      if (prompt === 'none') {
        return redirectWithOAuthError(validation.redirectUri, 'login_required', validation.state, c.req.url);
      }

      const continuation = await sealContinuation(c, options, validation);
      return c.redirect(appendParams(options.loginUrl, { continue: continuation }, c.req.url), 302);
    }

    const consentState: Pick<OAuthContinuationState, 'acr' | 'authTime' | 'userId'> = {
      acr: resolveOAuthAcr(session.sessionRecord),
      authTime: session.sessionRecord.createdAt.toISOString(),
      userId: session.user.id,
    };

    // Consent persistence (optional): skip the consent screen and issue the code directly
    // when a stored grant for the exact (user, client) covers every requested scope.
    // `prompt=consent` ALWAYS forces the screen; coverage is a strict set-superset check,
    // so any requested scope absent from the grant re-shows consent (scope-escalation guard).
    const skipConsent =
      prompt !== 'consent' &&
      (await hasCoveringGrant(options.ports, session.user.id, validation.client.clientId, validation.scope));

    if (prompt === 'none') {
      if (!skipConsent) {
        return redirectWithOAuthError(validation.redirectUri, 'consent_required', validation.state, c.req.url);
      }
    } else if (!skipConsent) {
      const sealedState = await sealContinuation(c, options, validation, consentState);
      return c.redirect(appendParams(options.consentUrl, { state: sealedState }, c.req.url), 302);
    }

    const sealedState = await sealContinuation(c, options, validation, consentState);
    const payload = await options.stateCodec.unseal(sealedState);
    if (!payload) {
      return oauthJsonError(c, 400, 'invalid_request', 'OAuth continuation is invalid.');
    }
    return issueAuthorizedCode(c, options, payload);
  };

/**
 * True iff `consentStore` is wired AND a stored grant for `(userId, clientId)` covers every
 * requested scope (stored ⊇ requested). No store ⇒ false (legacy always-consent). The
 * superset check is the scope-escalation invariant: a single uncovered scope forces consent.
 */
const hasCoveringGrant = async (
  ports: AuthHonoPorts,
  userId: string,
  clientId: string,
  requestedScope: string
): Promise<boolean> => {
  if (!ports.consentStore) return false;
  const grant = await ports.consentStore.getGrant(userId, clientId);
  if (!grant) return false;
  const granted = new Set(grant.scopes);
  const requested = requestedScope.split(/\s+/).filter(Boolean);
  return requested.every((scope) => granted.has(scope));
};

const resumeLoginContinuation = async (
  c: Context,
  options: OAuthAuthorizeHandlerOptions,
  continuation: string
): Promise<Response> => {
  const payload = await options.stateCodec.unseal(continuation);
  const now = options.ports.clock.now();
  if (!payload || payload.userId || payload.codeChallengeMethod !== 'S256' || new Date(payload.expiresAt) <= now) {
    return oauthJsonError(c, 400, 'invalid_request', 'OAuth continuation is invalid or expired.');
  }

  const client = await options.ports.oauthStateStore.findClient(payload.clientId);
  if (!client) return oauthJsonError(c, 400, 'invalid_request', 'Unknown OAuth client.');

  const redirectError = validateRedirectUri(client, payload.redirectUri);
  if (redirectError) return oauthJsonError(c, 400, 'invalid_request', redirectError);

  const scopeResult = validateScope(payload.scope, client, payload.redirectUri, payload.state, c.req.url);
  if (scopeResult instanceof Response) return scopeResult;

  const session = await resolveOAuthSession(c.req.raw, options.ports);
  if (!session) {
    return c.redirect(appendParams(options.loginUrl, { continue: continuation }, c.req.url), 302);
  }

  const expiresAt = options.ports.clock.addSeconds(now, options.stateTtlSeconds ?? 10 * 60);
  const sealedState = await options.stateCodec.seal({
    ...payload,
    acr: resolveOAuthAcr(session.sessionRecord),
    authTime: session.sessionRecord.createdAt.toISOString(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    scope: scopeResult,
    userId: session.user.id,
  });

  return c.redirect(appendParams(options.consentUrl, { state: sealedState }, c.req.url), 302);
};

const validateAuthorizeRequest = async (
  c: Context,
  ports: AuthHonoPorts
): Promise<ValidatedAuthorizeRequest | Response> => {
  const clientId = c.req.query('client_id');
  const client = clientId ? await ports.oauthStateStore.findClient(clientId) : null;
  if (!client) {
    return oauthJsonError(c, 400, 'invalid_request', 'Unknown OAuth client.');
  }

  const redirectUri = c.req.query('redirect_uri') ?? '';
  const redirectError = validateRedirectUri(client, redirectUri);
  if (redirectError) {
    return oauthJsonError(c, 400, 'invalid_request', redirectError);
  }

  const state = c.req.query('state') ?? null;
  if (c.req.query('response_type') !== 'code') {
    return redirectWithOAuthError(redirectUri, 'unsupported_response_type', state, c.req.url);
  }

  const codeChallenge = c.req.query('code_challenge') ?? '';
  if (!codeChallenge || c.req.query('code_challenge_method') !== 'S256') {
    return redirectWithOAuthError(redirectUri, 'invalid_request', state, c.req.url);
  }

  const scopeResult = validateScope(c.req.query('scope') ?? '', client, redirectUri, state, c.req.url);
  if (scopeResult instanceof Response) return scopeResult;

  const resourceResult = validateResource(c.req.queries('resource'), client, redirectUri, state, c.req.url);
  if (resourceResult instanceof Response) return resourceResult;

  return {
    client,
    codeChallenge,
    dpopJkt: c.req.query('dpop_jkt') ?? null,
    nonce: c.req.query('nonce') ?? null,
    redirectUri,
    resource: resourceResult,
    scope: scopeResult,
    state,
  };
};

const validateScope = (
  scope: string,
  client: OauthClientRecord,
  redirectUri: string,
  state: string | null,
  baseUrl: string
): string | Response => {
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  if (requestedScopes.includes('offline_access')) {
    return redirectWithOAuthError(redirectUri, 'invalid_scope', state, baseUrl);
  }
  if (requestedScopes.some((requestedScope) => !client.allowedScopes.includes(requestedScope))) {
    return redirectWithOAuthError(redirectUri, 'invalid_scope', state, baseUrl);
  }
  return requestedScopes.join(' ');
};

/**
 * RFC 8707 resource indicator validation on the `authorization_code` flow (BR-39l Lot 2).
 * - C1 single-aud: more than one `resource` value ⇒ `invalid_target` (no multi-audience tokens).
 * - C2 default-deny allowlist: a requested `resource` must be in `client.resourceIndicators`,
 *   else `invalid_target`. No `resource` ⇒ `null` (default-aud = userinfo, byte-identical to 0.5.0).
 * The validated value is sealed into the continuation and becomes the access-token `aud`.
 */
const validateResource = (
  resources: string[] | undefined,
  client: OauthClientRecord,
  redirectUri: string,
  state: string | null,
  baseUrl: string
): string | null | Response => {
  const requested = (resources ?? []).filter((value) => value.length > 0);
  if (requested.length === 0) return null;
  if (requested.length > 1) {
    return redirectWithOAuthError(redirectUri, 'invalid_target', state, baseUrl);
  }

  const value = requested[0];
  const allowlist = client.resourceIndicators ?? [];
  if (!allowlist.includes(value)) {
    return redirectWithOAuthError(redirectUri, 'invalid_target', state, baseUrl);
  }
  return value;
};

const sealContinuation = async (
  c: Context,
  options: OAuthAuthorizeHandlerOptions,
  request: ValidatedAuthorizeRequest,
  session?: Pick<OAuthContinuationState, 'acr' | 'authTime' | 'userId'>
): Promise<string> => {
  const now = options.ports.clock.now();
  const expiresAt = options.ports.clock.addSeconds(now, options.stateTtlSeconds ?? 10 * 60);

  // BR-39e: derive the tenant bound to this auth code from the user's VALIDATED membership,
  // never from the raw client/param. Legacy behavior (client tenant) when no tenancy spine is
  // wired. An explicit `?tenant=` selection is honored ONLY if it is an approved membership.
  let tenantId: string | null = request.client.tenantId;
  if (options.ports.tenant) {
    tenantId = null;
    if (session?.userId) {
      const approved = await options.ports.tenant.listApprovedTenantIds(session.userId);
      const requested = c.req.query('tenant') ?? null;
      if (requested) {
        tenantId = approved.includes(requested) ? requested : null;
      } else if (approved.length === 1) {
        tenantId = approved[0];
      }
      // 0 or >1 approved tenants without a valid explicit selection → no tenant claim
      // (a multi-tenant selection screen is deferred; the RP may re-request with ?tenant=).
    }
  }

  return options.stateCodec.seal({
    acr: session?.acr,
    authTime: session?.authTime,
    clientId: request.client.clientId,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: 'S256',
    createdAt: now.toISOString(),
    dpopJkt: request.dpopJkt,
    expiresAt: expiresAt.toISOString(),
    nonce: request.nonce,
    redirectUri: request.redirectUri,
    resource: request.resource,
    scope: request.scope,
    state: request.state,
    tenantId,
    userId: session?.userId,
  });
};
