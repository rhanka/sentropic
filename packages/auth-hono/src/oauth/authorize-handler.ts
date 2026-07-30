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
  /**
   * BR-39r L4: register URL for the invitation → device-enrollment deep link. When a
   * `sentropic_invite_token` is present and there is no live session, authorize routes here
   * (carrying `login_hint` + `sentropic_invite_token` as PLAIN params) instead of `loginUrl`.
   * Falls back to `loginUrl` when not provided.
   */
  registerUrl?: string;
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

    const validation = await validateAuthorizeRequest(c, options.ports, options.issuer);
    if (validation instanceof Response) return validation;

    // OIDC parses `prompt` as a space-delimited set of values (not an exact string). `none`
    // is exclusive and takes precedence. `login` OR `select_account` force re-authentication.
    const prompts = new Set((c.req.query('prompt') ?? '').split(/\s+/).filter(Boolean));
    const session = await resolveOAuthSession(c.req.raw, options.ports);

    // BR-39r L4 (OIDC Evolution 2): `login_hint` (standard) + namespaced `sentropic_invite_token`.
    // authorize ROUTES ONLY on token PRESENCE — it NEVER checks invite validity (validity is
    // checked + the token is consumed at registration; an emailed invite link is routinely
    // prefetched by scanners/AV, so consuming here would burn the real user's invite). C3: the
    // redirect SHAPE must not reveal invite validity or account existence.
    const loginHint = c.req.query('login_hint') || null;
    const inviteToken = c.req.query('sentropic_invite_token') || null;

    // Force re-auth when `prompt=login`/`select_account`, OR when `login_hint` is present and the
    // live session resolves to a DIFFERENT email (never silently authorize the wrong account).
    // Normalize BOTH sides for the comparison (the session email is not guaranteed lowercase); a
    // null session email is treated as a mismatch so a hinted RP flow cannot silently continue on
    // a session that cannot match the hint.
    let forceReauth = prompts.has('login') || prompts.has('select_account');
    if (session && loginHint) {
      const sessEmail = session.user.email?.trim().toLowerCase() ?? null;
      if (sessEmail !== loginHint.trim().toLowerCase()) {
        forceReauth = true;
      }
    }

    if (!session || forceReauth) {
      if (prompts.has('none')) {
        // `prompt=none` cannot be satisfied without re-auth: surface the precise OIDC error.
        const errorCode = prompts.has('select_account') ? 'account_selection_required' : 'login_required';
        return redirectWithOAuthError(validation.redirectUri, errorCode, validation.state, c.req.url, options.issuer);
      }

      // Seal the force-reauth intent + the CURRENT session id (if any). HMAC-signed → tamper-proof.
      // Do NOT proactively revoke: the user may abandon the flow and keep their session.
      const continuation = await sealContinuation(c, options, validation, undefined, {
        forceReauth,
        forceReauthSessionId: session?.sessionRecord.id,
      });

      // Invite present + no live session ⇒ route to the register (device-enrollment) surface,
      // carrying the OAuth request in the sealed `continue` and `login_hint` + the invite token
      // as PLAIN params (the token IS the single-use bearer secret; registration's atomic consume
      // binds token↔email). A live session that must re-auth still goes to login (not register).
      if (inviteToken && !session && options.registerUrl) {
        const registerParams: Record<string, string> = { continue: continuation, sentropic_invite_token: inviteToken };
        if (loginHint) registerParams.login_hint = loginHint;
        return c.redirect(appendParams(options.registerUrl, registerParams, c.req.url), 302);
      }

      // login_hint (with or without invite when no registerUrl is wired) ⇒ pre-fill login.
      const loginParams: Record<string, string> = { continue: continuation };
      if (loginHint) loginParams.login_hint = loginHint;
      return c.redirect(appendParams(options.loginUrl, loginParams, c.req.url), 302);
    }

    const consentState: Pick<OAuthContinuationState, 'acr' | 'authTime' | 'userId'> = {
      acr: resolveOAuthAcr(session.sessionRecord),
      authTime: session.sessionRecord.createdAt.toISOString(),
      userId: session.user.id,
    };

    // Consent persistence (optional): skip the consent screen and issue the code directly
    // when a stored grant for the exact (user, client[, tenant]) covers every requested scope.
    // `prompt=consent` ALWAYS forces the screen; coverage is a strict set-superset check,
    // so any requested scope absent from the grant re-shows consent (scope-escalation guard).
    const authorizeTenantId = await deriveAuthorizeTenantId(
      options.ports,
      validation.client.tenantId,
      session.user.id,
      c.req.query('tenant') ?? null
    );
    const skipConsent =
      !prompts.has('consent') &&
      (await hasCoveringGrant(
        options.ports,
        session.user.id,
        validation.client.clientId,
        validation.scope,
        authorizeTenantId
      ));

    if (prompts.has('none')) {
      if (!skipConsent) {
        return redirectWithOAuthError(validation.redirectUri, 'consent_required', validation.state, c.req.url, options.issuer);
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
 * ARCH-11 G1c (spec §4.2.5): derive the org the authorize request is scoped to. This is the SAME
 * derivation `sealContinuation` seals into the auth code — extracted so the consent skip-check keys
 * on the same tenant. Legacy (no tenancy spine) ⇒ the client's tenant, byte-identical to pre-G1c:
 *  - no `tenant` port          → `clientTenantId` (legacy).
 *  - no session user           → null (no tenant claim).
 *  - `requestedTenant` present → honored ONLY if an approved membership, else null.
 *  - exactly one approved org  → that org.
 *  - 0 or >1 without selection  → null (a multi-tenant selection screen is deferred; RP re-requests).
 *
 * `requestedTenant` is passed IN rather than read from the request: on the post-login resume the
 * URL carries `continue` alone, so the caller sources it from the sealed continuation instead of
 * the query string. Taking it as a parameter keeps both call paths on one derivation.
 */
const deriveAuthorizeTenantId = async (
  ports: AuthHonoPorts,
  clientTenantId: string | null,
  userId: string | undefined,
  requestedTenant: string | null
): Promise<string | null> => {
  if (!ports.tenant) return clientTenantId;
  if (!userId) return null;
  const approved = await ports.tenant.listApprovedTenantIds(userId);
  if (requestedTenant) return approved.includes(requestedTenant) ? requestedTenant : null;
  if (approved.length === 1) return approved[0];
  return null;
};

/**
 * True iff `consentStore` is wired AND a stored grant for `(userId, clientId[, tenantId])` covers
 * every requested scope (stored ⊇ requested). No store ⇒ false (legacy always-consent). The
 * superset check is the scope-escalation invariant: a single uncovered scope forces consent.
 *
 * ARCH-11 G1c: `tenantId` is the org the request is scoped to. Under strict the adapter keys the
 * lookup on the tenant leg, so an org-A grant never skips consent in org-B (the §1.5 bypass fix);
 * under alias/shadow the adapter ignores it (byte-identical).
 */
const hasCoveringGrant = async (
  ports: AuthHonoPorts,
  userId: string,
  clientId: string,
  requestedScope: string,
  tenantId: string | null
): Promise<boolean> => {
  if (!ports.consentStore) return false;
  const grant = await ports.consentStore.getGrant(userId, clientId, tenantId ?? undefined);
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

  const scopeResult = validateScope(payload.scope, client, payload.redirectUri, payload.state, c.req.url, options.issuer);
  if (scopeResult instanceof Response) return scopeResult;

  const session = await resolveOAuthSession(c.req.raw, options.ports);
  // C2: close the silent-resume gap. With no session, OR when force-reauth was sealed AND the
  // resolved session is still the SAME pre-existing session (the user did not actually re-auth),
  // re-redirect to login. A genuinely fresh login mints a NEW session id ≠ the sealed old id →
  // resume proceeds to consent.
  if (!session || (payload.forceReauth && session.sessionRecord.id === payload.forceReauthSessionId)) {
    return c.redirect(appendParams(options.loginUrl, { continue: continuation }, c.req.url), 302);
  }

  // ARCH-11 §4.2.4: the continuation was sealed BEFORE login, so `deriveAuthorizeTenantId` ran with
  // no `userId` and necessarily returned null (`if (!userId) return null`). Re-derive it HERE, now
  // that the session identifies the principal, and seal THAT value. Spreading `...payload` alone
  // carries the stale null into the auth code, and every token minted from this (dominant)
  // cold-start flow then carries no `tid` at all — a tenancy hole that fails quietly rather than
  // loudly. §4.2.4 requires every emitted `tid` to be the output of an explicit resolution for the
  // authenticated principal; a value inherited through a spread is not one.
  // The resume URL carries `continue` ALONE — no `?tenant=` — so the selection must come from the
  // sealed continuation, not the request. Reading the query here would silently drop a multi-org
  // user's explicit choice and fall through to "0 or >1 approved ⇒ null".
  const resumeTenantId = await deriveAuthorizeTenantId(
    options.ports,
    client.tenantId,
    session.user.id,
    payload.requestedTenant ?? null
  );

  const expiresAt = options.ports.clock.addSeconds(now, options.stateTtlSeconds ?? 10 * 60);

  // Every field whose correct value depends on the now-established session is destructured OUT of
  // `payload` here, so it cannot ride the spread with its stale pre-login value; `restFromRequest`
  // holds only request-scoped fields. Do not collapse this back into `{...payload, <named fields>}`:
  // that form is a positive enumeration with no completeness guarantee, and it is what let
  // `tenantId` be forgotten in the first place.
  //
  // HOW MUCH THE COMPILER ACTUALLY GUARANTEES — read this before trusting it. `tenantId`,
  // `createdAt`, `expiresAt` and `scope` are REQUIRED members, so once excluded from the spread,
  // omitting them from the rebuild below is a type error. `acr`, `authTime` and `userId` are
  // OPTIONAL: omitting those compiles fine and silently yields `undefined`. And a BRAND-NEW
  // session-dependent field added to OAuthContinuationState gets no check at all — absent from
  // this exclusion list it simply rides `restFromRequest` with its stale value, structurally
  // satisfying the interface. So: review this list BY HAND whenever a session-dependent field is
  // added to the state type. The compiler backstops four fields; it will not remind you.
  const {
    acr: _preLoginAcr,
    authTime: _preLoginAuthTime,
    createdAt: _preLoginCreatedAt,
    expiresAt: _preLoginExpiresAt,
    scope: _preValidationScope,
    tenantId: _preLoginTenantId,
    userId: _preLoginUserId,
    ...restFromRequest
  } = payload;

  const sealedState = await options.stateCodec.seal({
    ...restFromRequest,
    acr: resolveOAuthAcr(session.sessionRecord),
    authTime: session.sessionRecord.createdAt.toISOString(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    scope: scopeResult,
    tenantId: resumeTenantId,
    userId: session.user.id,
  });

  // `prompt=login` forces re-AUTHENTICATION but must NOT force re-CONSENT (OIDC): a stored grant
  // covering the requested scopes still applies. Mirror the main-flow skipConsent check here so the
  // re-auth resume issues the code directly instead of re-showing consent on every login. Note:
  // `prompt=consent` never sets forceReauth, so it never reaches this resume path — no consent
  // override is bypassed, and scope-escalation stays guarded by hasCoveringGrant's superset check.
  // `resumeTenantId` is the SAME value sealed above, so the grant this check READS and the grant
  // the consent handler later WRITES are keyed on one tenant. When they diverged, the write passed
  // `undefined` and Postgres applied the `oauth_consents` column default.
  if (await hasCoveringGrant(options.ports, session.user.id, client.clientId, scopeResult, resumeTenantId)) {
    const codePayload = await options.stateCodec.unseal(sealedState);
    if (codePayload) return issueAuthorizedCode(c, options, codePayload);
  }

  return c.redirect(appendParams(options.consentUrl, { state: sealedState }, c.req.url), 302);
};

const validateAuthorizeRequest = async (
  c: Context,
  ports: AuthHonoPorts,
  issuer: string
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
    return redirectWithOAuthError(redirectUri, 'unsupported_response_type', state, c.req.url, issuer);
  }

  const codeChallenge = c.req.query('code_challenge') ?? '';
  if (!codeChallenge || c.req.query('code_challenge_method') !== 'S256') {
    return redirectWithOAuthError(redirectUri, 'invalid_request', state, c.req.url, issuer);
  }

  const scopeResult = validateScope(c.req.query('scope') ?? '', client, redirectUri, state, c.req.url, issuer);
  if (scopeResult instanceof Response) return scopeResult;

  const resourceResult = validateResource(c.req.queries('resource'), client, redirectUri, state, c.req.url, issuer);
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
  baseUrl: string,
  issuer: string
): string | Response => {
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  if (requestedScopes.includes('offline_access')) {
    return redirectWithOAuthError(redirectUri, 'invalid_scope', state, baseUrl, issuer);
  }
  if (requestedScopes.some((requestedScope) => !client.allowedScopes.includes(requestedScope))) {
    return redirectWithOAuthError(redirectUri, 'invalid_scope', state, baseUrl, issuer);
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
  baseUrl: string,
  issuer: string
): string | null | Response => {
  const requested = (resources ?? []).filter((value) => value.length > 0);
  if (requested.length === 0) return null;
  if (requested.length > 1) {
    return redirectWithOAuthError(redirectUri, 'invalid_target', state, baseUrl, issuer);
  }

  const value = requested[0];
  const allowlist = client.resourceIndicators ?? [];
  if (!allowlist.includes(value)) {
    return redirectWithOAuthError(redirectUri, 'invalid_target', state, baseUrl, issuer);
  }
  return value;
};

const sealContinuation = async (
  c: Context,
  options: OAuthAuthorizeHandlerOptions,
  request: ValidatedAuthorizeRequest,
  session?: Pick<OAuthContinuationState, 'acr' | 'authTime' | 'userId'>,
  forceReauth?: Pick<OAuthContinuationState, 'forceReauth' | 'forceReauthSessionId'>
): Promise<string> => {
  const now = options.ports.clock.now();
  const expiresAt = options.ports.clock.addSeconds(now, options.stateTtlSeconds ?? 10 * 60);

  // BR-39e: derive the tenant bound to this auth code from the user's VALIDATED membership,
  // never from the raw client/param. Legacy behavior (client tenant) when no tenancy spine is
  // wired. An explicit `?tenant=` selection is honored ONLY if it is an approved membership.
  // ARCH-11 G1c: same derivation as the consent skip-check (`deriveAuthorizeTenantId`).
  const requestedTenant = c.req.query('tenant') ?? null;
  const tenantId = await deriveAuthorizeTenantId(
    options.ports,
    request.client.tenantId,
    session?.userId,
    requestedTenant
  );

  return options.stateCodec.seal({
    acr: session?.acr,
    authTime: session?.authTime,
    clientId: request.client.clientId,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: 'S256',
    createdAt: now.toISOString(),
    dpopJkt: request.dpopJkt,
    expiresAt: expiresAt.toISOString(),
    forceReauth: forceReauth?.forceReauth,
    forceReauthSessionId: forceReauth?.forceReauthSessionId,
    nonce: request.nonce,
    redirectUri: request.redirectUri,
    requestedTenant,
    resource: request.resource,
    scope: request.scope,
    state: request.state,
    tenantId,
    userId: session?.userId,
  });
};
