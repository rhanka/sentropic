import { createAuthSessionService, type AuthHonoDeviceInfo } from '@sentropic/auth-hono';
import { generateCodeVerifier, generateState } from 'arctic';
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { createFederationBroker } from '../../services/auth/federation/broker';
import {
  isFederationProviderSupported,
  resolveFederationProvider,
} from '../../services/auth/federation/registry';
import type { FederationProvider } from '../../services/auth/federation/types';
import { ensureWorkspaceForUser } from '../../services/workspace-service';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthUiBaseUrl } from './oauth';

/**
 * BR-39e Lot 1 — federation broker routes (upstream of the OAuth server, §6).
 *
 * `GET /auth/federation/:provider/start`    → build the provider auth URL, set the bound flow-state
 *                                             cookie carrying only the opaque pointer, 302 upstream.
 * `GET /auth/federation/:provider/callback` → consume the flow-state, verify state/nonce/PKCE,
 *                                             resolve+link, mint a FRESH Sentropic session (rotation),
 *                                             then resume the sealed continuation or land internally.
 *
 * This router is the thin HTTP/cookie transport; every security invariant lives in the pure broker
 * (`services/auth/federation/broker.ts`). Active only when the host wires the `federation?` port.
 */

const FLOW_COOKIE = 'sentropic_fed_flow';
const FLOW_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTO_LINK_PROVIDERS: ReadonlySet<string> = new Set(['google']);

export const federationRouter = new Hono();

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

const deviceInfoFrom = (c: Context): AuthHonoDeviceInfo => ({
  ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
  userAgent: c.req.header('user-agent'),
});

const brokerFor = (c: Context, provider: FederationProvider) => {
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
      authorizeUrl: `${issuer}/auth/oauth/authorize`,
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
  const defaultRedirectUri = `${resolveOAuthIssuer(c.req.raw)}/auth/federation/${providerId}/callback`;
  const provider = resolveFederationProvider(providerId, { defaultRedirectUri });
  if (!provider) {
    return c.json(
      { error: { code: 'provider_not_configured', message: `Provider "${providerId}" is not configured.` } },
      503,
    );
  }
  return provider;
};

federationRouter.get('/:provider/start', async (c) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  const result = await brokerFor(c, provider).start({
    continuation: c.req.query('continue') ?? null,
    deviceInfo: deviceInfoFrom(c),
  });
  if (result.kind === 'error') return c.json(result.body, result.status as 400 | 500);

  // The bound cookie carries ONLY the opaque flow-state pointer (D5). SameSite=Lax so the top-level
  // redirect back from the provider still presents it on the callback.
  setCookie(c, FLOW_COOKIE, result.flowStateId, {
    httpOnly: true,
    maxAge: FLOW_TTL_SECONDS,
    path: '/auth/federation',
    sameSite: 'Lax',
    secure: isProduction(),
  });
  return c.redirect(result.location, 302);
});

federationRouter.get('/:provider/callback', async (c) => {
  const provider = resolveOrRespond(c);
  if (provider instanceof Response) return provider;

  const result = await brokerFor(c, provider).callback({
    code: c.req.query('code') ?? null,
    deviceInfo: deviceInfoFrom(c),
    error: c.req.query('error') ?? null,
    flowStateId: getCookie(c, FLOW_COOKIE) ?? null,
    state: c.req.query('state') ?? null,
  });

  if (result.kind === 'authenticated') {
    // Fresh Sentropic session (rotation, D10) as an HttpOnly cookie; the external tokens never
    // reach the browser (D1). The one-time flow-state cookie is cleared.
    setCookie(c, 'session', result.session.sessionToken, {
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
      sameSite: 'Lax',
      secure: isProduction(),
    });
    deleteCookie(c, FLOW_COOKIE, { path: '/auth/federation' });
    return c.redirect(result.location, 302);
  }

  if (result.clearFlowCookie) deleteCookie(c, FLOW_COOKIE, { path: '/auth/federation' });
  return c.json(result.body, result.status as 400 | 401 | 409 | 500);
});
