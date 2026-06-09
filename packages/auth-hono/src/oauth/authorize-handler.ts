import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import type { OauthClientRecord } from './state-store-types.js';
import type { OAuthContinuationCodec, OAuthContinuationState } from './state-codec.js';
import { appendParams, oauthJsonError, redirectWithOAuthError } from './http-utils.js';
import { resolveOAuthAcr, resolveOAuthSession } from './session-resolver.js';

export interface OAuthAuthorizeHandlerOptions {
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

    if (prompt === 'none') {
      return redirectWithOAuthError(validation.redirectUri, 'consent_required', validation.state, c.req.url);
    }

    const sealedState = await sealContinuation(c, options, validation, {
      acr: resolveOAuthAcr(session.sessionRecord),
      authTime: session.sessionRecord.createdAt.toISOString(),
      userId: session.user.id,
    });

    return c.redirect(appendParams(options.consentUrl, { state: sealedState }, c.req.url), 302);
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

  return {
    client,
    codeChallenge,
    dpopJkt: c.req.query('dpop_jkt') ?? null,
    nonce: c.req.query('nonce') ?? null,
    redirectUri,
    scope: scopeResult,
    state,
  };
};

const validateRedirectUri = (client: OauthClientRecord, redirectUri: string): string | null => {
  if (!client.redirectUris.includes(redirectUri)) return 'redirect_uri is not registered for this client.';

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return 'redirect_uri must be an absolute URI.';
  }

  if (parsed.hash) return 'redirect_uri must not contain a fragment.';
  if (parsed.username || parsed.password) return 'redirect_uri must not contain credentials.';
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
  return 'redirect_uri must use https except for localhost development callbacks.';
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
    scope: request.scope,
    state: request.state,
    tenantId,
    userId: session?.userId,
  });
};
