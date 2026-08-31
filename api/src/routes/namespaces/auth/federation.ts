import { createAuthSessionService, type AuthHonoDeviceInfo } from '@sentropic/auth-hono';
import { generateCodeVerifier, generateState } from 'arctic';
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { createFederationBroker } from '../../../services/auth/federation/broker';
import { pendingFederationStore } from '../../../services/auth/federation/pending-store';
import {
  isFederationProviderSupported,
  resolveFederationProvider,
} from '../../../services/auth/federation/registry';
import type {
  FederationCallbackProfile,
  FederationProvider,
} from '../../../services/auth/federation/types';
import { verifyValidationToken } from '../../../services/email-verification';
import { validateSession } from '../../../services/session-manager';
import { ensureWorkspaceForUser } from '../../../services/workspace-service';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthUiBaseUrl } from '../../auth/oauth';

/**
 * BR-39e Lot 1 — federation broker routes (upstream of the OAuth server, §6).
 *
 * `GET /auth/federation/:provider/start`    → build the provider auth URL, set the bound flow-state
 *                                             cookie carrying only the opaque pointer, 302 upstream.
 * `GET|POST /auth/federation/:provider/callback` → GET for ordinary providers; Apple's `form_post`
 *                                                  body carries code/state and its one-time profile.
 *
 * This router is the thin HTTP/cookie transport; every security invariant lives in the pure broker
 * (`services/auth/federation/broker.ts`). Active only when the host wires the `federation?` port.
 */

// The API is mounted at `/api/v1` (`api/src/app.ts`: `app.route('/api/v1/auth', authRouter)`), and
// this router is nested at `/federation` under it (`api/src/routes/auth/index.ts`:
// `authRouter.route('/federation', federationRouter)`) — so the callback is REALLY served at
// `/api/v1/auth/federation/<provider>/callback`. The default redirect URI (used whenever the
// provider-specific `*_OAUTH_REDIRECT_URI` env is unset) must carry that full mount prefix, mirroring
// the OAuth `oauthPathPrefix` convention (`packages/auth-hono/.../wellknown-handler.ts`, default
// `/api/v1/auth/oauth`). Omitting `/api/v1` here sends the provider redirect to the SPA, not the API.
const FEDERATION_CALLBACK_PREFIX = '/api/v1/auth/federation';

const federationCallbackUrl = (issuer: string, providerId: string): string =>
  `${issuer}${FEDERATION_CALLBACK_PREFIX}/${providerId}/callback`;

const FLOW_COOKIE = 'sentropic_fed_flow';
// BR-39e Lot 2 — the authenticated manual-link flow uses a DISTINCT bound cookie so its callback
// cannot be reached with a plain login flow-state (and vice-versa).
const LINK_FLOW_COOKIE = 'sentropic_fed_link_flow';
// BR-39e Lot 2 — the email-verification challenge pointer (D9); references the pending identity.
const CHALLENGE_COOKIE = 'sentropic_fed_challenge';
const FLOW_TTL_SECONDS = 10 * 60;
const CHALLENGE_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// D8 auto-link allowlist — GOOGLE ONLY in v1. GitHub and Apple are deliberately absent: their
// verified-email collisions route to the authenticated manual-link flow below.
const AUTO_LINK_PROVIDERS: ReadonlySet<string> = new Set(['google']);

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

const deviceInfoFrom = (c: Context): AuthHonoDeviceInfo => ({
  ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
  userAgent: c.req.header('user-agent'),
});

interface CallbackParamSource {
  method: string;
  parseBody(): Promise<Record<string, unknown>>;
  query(name: string): string | undefined;
}

export interface ParsedFederationCallback {
  code: string | null;
  error: string | null;
  profile: FederationCallbackProfile | null;
  state: string | null;
}

const stringField = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseAppleProfile = (raw: string | null): FederationCallbackProfile | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const email = stringField(value.email);
    const name = value.name && typeof value.name === 'object' ? value.name as Record<string, unknown> : {};
    const displayName = [stringField(name.firstName), stringField(name.lastName)].filter(Boolean).join(' ') || null;
    return email || displayName ? { displayName, email } : null;
  } catch {
    return null;
  }
};

/** Select the callback transport before reading parameters; Apple GET query values are never accepted. */
export const parseFederationCallback = async (
  providerId: string,
  source: CallbackParamSource,
): Promise<ParsedFederationCallback> => {
  if (providerId === 'apple' && source.method === 'POST') {
    const body = await source.parseBody();
    return {
      code: stringField(body.code),
      error: stringField(body.error),
      profile: parseAppleProfile(stringField(body.user)),
      state: stringField(body.state),
    };
  }
  if (providerId !== 'apple' && source.method === 'GET') {
    return {
      code: source.query('code') ?? null,
      error: source.query('error') ?? null,
      profile: null,
      state: source.query('state') ?? null,
    };
  }
  return { code: null, error: null, profile: null, state: null };
};

// Resolve the authenticated session's user id (cookie or bearer), or null when unauthenticated.
const sessionUserId = async (c: Context): Promise<string | null> => {
  const sessionToken =
    getCookie(c, 'session') || c.req.header('authorization')?.replace('Bearer ', '');
  if (!sessionToken) return null;
  const session = await validateSession(sessionToken);
  return session?.userId ?? null;
};

const setSessionCookie = (c: Context, sessionToken: string): void => {
  setCookie(c, 'session', sessionToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure: isProduction(),
  });
};

const brokerFor = (
  c: Context,
  provider: FederationProvider,
  oauthAuthorizePath: string,
) => {
  const ports = getSentropicOAuthPorts();
  const sessionService = createAuthSessionService({ ports });
  const issuer = resolveOAuthIssuer(c.req.raw);
  const uiBase = resolveOAuthUiBaseUrl(c.req.raw);

  return createFederationBroker({
    accountPolicy: ports.accountPolicy,
    audit: ports.auditLog,
    clock: ports.clock,
    config: {
      // D11: resume the sealed continuation via the authorize endpoint, else a FIXED internal page.
      authorizeUrl: `${issuer}${oauthAuthorizePath}`,
      autoLinkProviders: AUTO_LINK_PROVIDERS,
      flowStateTtlSeconds: FLOW_TTL_SECONDS,
      landingUrl: `${uiBase}/`,
    },
    // The federation port is optional on the ports bag; this host always wires it (Lot 0 adapter).
    federation: ports.federation!,
    mintSession: (input) => sessionService.createSession(input),
    provider,
    provisionWorkspace: async (userId: string) => {
      await ensureWorkspaceForUser(userId);
    },
    secrets: {
      codeVerifier: generateCodeVerifier,
      nonce: () => randomBytes(32).toString('base64url'),
      state: generateState,
    },
    users: ports.users,
  });
};

// Resolve the provider or short-circuit with a clear response: 404 unknown, 503 not configured,
// 501 when federation is not wired on this host. Returns null when a Response was already produced.
const resolveOrRespond = (c: Context): FederationProvider | Response => {
  if (!getSentropicOAuthPorts().federation) {
    return c.json({ error: { code: 'federation_unavailable', message: 'Federation is not enabled.' } }, 501);
  }
  const providerId = c.req.param('provider');
  if (!providerId || !isFederationProviderSupported(providerId)) {
    return c.json(
      { error: { code: 'provider_not_supported', message: `Unknown provider "${providerId ?? ''}".` } },
      404,
    );
  }
  const defaultRedirectUri = federationCallbackUrl(resolveOAuthIssuer(c.req.raw), providerId);
  const provider = resolveFederationProvider(providerId, { defaultRedirectUri });
  if (!provider) {
    return c.json(
      { error: { code: 'provider_not_configured', message: `Provider "${providerId}" is not configured.` } },
      503,
    );
  }
  return provider;
};

export const createFederationRouter = (oauthAuthorizePath: string): Hono => {
const federationRouter = new Hono();

federationRouter.get('/:provider/start', async (c) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  const result = await brokerFor(c, provider, oauthAuthorizePath).start({
    continuation: c.req.query('continue') ?? null,
    deviceInfo: deviceInfoFrom(c),
  });
  if (result.kind === 'error') return c.json(result.body, result.status as 400 | 500);

  // The bound cookie carries ONLY the opaque flow-state pointer (D5). Apple uses `response_mode=
  // form_post`, so its callback is a CROSS-SITE top-level POST from appleid.apple.com — browsers
  // (notably Safari) will NOT send a SameSite=Lax cookie on it, so Apple's flow cookie must be
  // SameSite=None; Secure. The GET-redirect providers keep SameSite=Lax (Secure only in prod), which
  // is still presented on their same-navigation top-level GET callback.
  const crossSitePostCallback = provider.id === 'apple';
  setCookie(c, FLOW_COOKIE, result.flowStateId, {
    httpOnly: true,
    maxAge: FLOW_TTL_SECONDS,
    path: '/auth/federation',
    sameSite: crossSitePostCallback ? 'None' : 'Lax',
    secure: crossSitePostCallback ? true : isProduction(),
  });
  return c.redirect(result.location, 302);
});

const callbackHandler = async (c: Context) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  const params = await parseFederationCallback(provider.id, {
    method: c.req.method,
    parseBody: () => c.req.parseBody(),
    query: (name) => c.req.query(name),
  });

  const result = await brokerFor(c, provider, oauthAuthorizePath).callback({
    code: params.code,
    deviceInfo: deviceInfoFrom(c),
    error: params.error,
    flowStateId: getCookie(c, FLOW_COOKIE) ?? null,
    profile: params.profile,
    state: params.state,
  });

  if (result.kind === 'authenticated') {
    // Fresh Sentropic session (rotation, D10) as an HttpOnly cookie; the external tokens never
    // reach the browser (D1). The one-time flow-state cookie is cleared.
    setSessionCookie(c, result.session.sessionToken);
    deleteCookie(c, FLOW_COOKIE, { path: '/auth/federation' });
    return c.redirect(result.location, 302);
  }

  if (result.kind === 'email-challenge') {
    // D9 — no usable verified email; NO user was created. Stash the pending identity server-side,
    // reference it by a bound cookie, and hand the browser to the local email-verification challenge
    // (which POSTs to /auth/federation/challenge/complete once an email is proven).
    deleteCookie(c, FLOW_COOKIE, { path: '/auth/federation' });
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const challengeId = pendingFederationStore.put(
      {
        continuation: result.continuation,
        provider: result.provider,
        providerSubject: result.providerSubject,
        providerTenant: result.providerTenant,
      },
      expiresAt,
    );
    setCookie(c, CHALLENGE_COOKIE, challengeId, {
      httpOnly: true,
      maxAge: CHALLENGE_TTL_SECONDS,
      path: '/auth/federation',
      sameSite: 'Lax',
      secure: isProduction(),
    });
    const uiBase = resolveOAuthUiBaseUrl(c.req.raw);
    return c.redirect(`${uiBase}/auth/federation/verify-email?provider=${result.provider}`, 302);
  }

  if (result.clearFlowCookie) deleteCookie(c, FLOW_COOKIE, { path: '/auth/federation' });
  return c.json(result.body, result.status as 400 | 401 | 409 | 500);
};

federationRouter.get('/:provider/callback', callbackHandler);
federationRouter.post('/:provider/callback', callbackHandler);

/**
 * BR-39e Lot 2 — the AUTHENTICATED manual-link flow (D7, §3.3 step 6). This is the ONLY path that
 * attaches a provider to a credentialed account. The already-signed-in user starts here; on callback
 * the freshly re-proven identity is bound to THAT session's user — never a silent merge.
 *
 * `GET /:provider/link/start`    → require a session, build the provider auth URL, set the DISTINCT
 *                                  link flow-state cookie, 302 upstream.
 * `GET|POST /:provider/link/callback` → require a session, consume the link flow-state, verify, and
 *                                       link the identity to the session's user (POST for Apple).
 */
federationRouter.get('/:provider/link/start', async (c) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  const userId = await sessionUserId(c);
  if (!userId) {
    return c.json(
      { error: { code: 'authentication_required', message: 'Sign in before linking a provider.' } },
      401,
    );
  }

  // A link flow carries NO downstream OAuth continuation — it always lands the user back internally.
  const result = await brokerFor(c, provider, oauthAuthorizePath).start({
    continuation: null,
    deviceInfo: deviceInfoFrom(c),
  });
  if (result.kind === 'error') return c.json(result.body, result.status as 400 | 500);

  // Same cross-site rule as the login flow: Apple's link callback is also a form_post POST, so its
  // bound cookie must be SameSite=None; Secure. The GET-redirect providers keep SameSite=Lax.
  const crossSitePostCallback = provider.id === 'apple';
  setCookie(c, LINK_FLOW_COOKIE, result.flowStateId, {
    httpOnly: true,
    maxAge: FLOW_TTL_SECONDS,
    path: '/auth/federation',
    sameSite: crossSitePostCallback ? 'None' : 'Lax',
    secure: crossSitePostCallback ? true : isProduction(),
  });
  return c.redirect(result.location, 302);
});

const linkCallbackHandler = async (c: Context) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  // The session at callback time is the link target (K-MANUAL-LINK-AUTH). Unauthenticated ⇒ the broker
  // rejects before consuming the flow-state or verifying anything.
  const userId = await sessionUserId(c);
  const params = await parseFederationCallback(provider.id, {
    method: c.req.method,
    parseBody: () => c.req.parseBody(),
    query: (name) => c.req.query(name),
  });

  const result = await brokerFor(c, provider, oauthAuthorizePath).linkCallback({
    code: params.code,
    deviceInfo: deviceInfoFrom(c),
    error: params.error,
    flowStateId: getCookie(c, LINK_FLOW_COOKIE) ?? null,
    linkUserId: userId,
    profile: params.profile,
    state: params.state,
  });

  if (result.kind === 'linked') {
    deleteCookie(c, LINK_FLOW_COOKIE, { path: '/auth/federation' });
    const uiBase = resolveOAuthUiBaseUrl(c.req.raw);
    return c.redirect(`${uiBase}/settings/security?linked=${provider.id}`, 302);
  }

  if (result.clearFlowCookie) deleteCookie(c, LINK_FLOW_COOKIE, { path: '/auth/federation' });
  return c.json(result.body, result.status as 400 | 401 | 409 | 500);
};

federationRouter.get('/:provider/link/callback', linkCallbackHandler);
federationRouter.post('/:provider/link/callback', linkCallbackHandler);

const challengeCompleteSchema = z.object({
  email: z.string().email(),
  verificationToken: z.string().min(1),
});

/**
 * BR-39e Lot 2 — finish an email-verification challenge (D9, §3.3 step 4→5). The UI has driven the
 * existing email-verification-code flow (`/auth/email/verify-request` + `/verify-code`) to obtain a
 * `verificationToken` proving an email. This route validates that proof, dereferences the pending
 * identity (verify-and-DELETE), and finishes via the broker (create shell user + link, or manual-link
 * on a collision — GitHub NEVER auto-links, D8).
 */
federationRouter.post('/challenge/complete', async (c) => {
  if (!getSentropicOAuthPorts().federation) {
    return c.json({ error: { code: 'federation_unavailable', message: 'Federation is not enabled.' } }, 501);
  }

  const challengeId = getCookie(c, CHALLENGE_COOKIE) ?? null;
  if (!challengeId) {
    return c.json(
      { error: { code: 'federation_challenge_missing', message: 'No federation challenge in progress.' } },
      400,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = challengeCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_request', message: 'A verified email is required.' } }, 400);
  }
  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Proof-of-email: the verification token (issued by the email-code flow) must be valid AND match the
  // submitted email. A caller cannot claim an arbitrary email without holding a real proof for it.
  const proof = await verifyValidationToken(parsed.data.verificationToken);
  if (!proof.valid || proof.email?.trim().toLowerCase() !== normalizedEmail) {
    return c.json(
      { error: { code: 'email_verification_required', message: 'Email ownership was not proven.' } },
      400,
    );
  }

  // Verify-and-DELETE the pending pointer (single-use + TTL) only AFTER the email proof succeeds.
  const pending = pendingFederationStore.consume(challengeId, new Date());
  deleteCookie(c, CHALLENGE_COOKIE, { path: '/auth/federation' });
  if (!pending) {
    return c.json(
      { error: { code: 'federation_challenge_invalid', message: 'Challenge is missing, expired, or already used.' } },
      400,
    );
  }

  const providerId = pending.provider;
  if (!isFederationProviderSupported(providerId)) {
    return c.json({ error: { code: 'provider_not_supported', message: `Unknown provider "${providerId}".` } }, 404);
  }
  const defaultRedirectUri = federationCallbackUrl(resolveOAuthIssuer(c.req.raw), providerId);
  const provider = resolveFederationProvider(providerId, { defaultRedirectUri });
  if (!provider) {
    return c.json({ error: { code: 'provider_not_configured', message: `Provider "${providerId}" is not configured.` } }, 503);
  }

  const result = await brokerFor(c, provider, oauthAuthorizePath).completeEmailChallenge({
    continuation: pending.continuation,
    deviceInfo: deviceInfoFrom(c),
    provider: providerId,
    providerSubject: pending.providerSubject,
    providerTenant: pending.providerTenant,
    verifiedEmail: normalizedEmail,
  });

  if (result.kind === 'authenticated') {
    setSessionCookie(c, result.session.sessionToken);
    return c.json({ location: result.location, success: true });
  }

  // A challenge email that collides with an existing account routes to manual-link (never merges).
  if (result.kind === 'email-challenge') {
    return c.json(
      { error: { code: 'email_verification_required', message: 'A verified email is required to continue.' } },
      400,
    );
  }
  return c.json(result.body, result.status as 400 | 401 | 409 | 500);
});

return federationRouter;
};
