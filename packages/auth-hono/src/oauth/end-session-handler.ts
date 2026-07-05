import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { appendParams } from './http-utils.js';
import { createJwksService } from './jwks-service.js';
import { validateRedirectUri } from './redirect-utils.js';
import type { OauthClientRecord } from './state-store-types.js';

export interface OAuthEndSessionHandlerOptions {
  issuer: string;
  ports: AuthHonoPorts;
}

const LOGGED_OUT_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed out</title></head>' +
  '<body><p>You have been signed out.</p></body></html>';

/**
 * OIDC RP-Initiated Logout 1.0 — `GET /oauth/end_session`.
 *
 * Params: `id_token_hint?`, `client_id?`, `post_logout_redirect_uri?`, `state?`
 * (`logout_hint` is accepted but ignored).
 *
 * Flow (BR-39r L3, section A):
 *  1. Resolve the local IdP session with LOW-LEVEL ports (NOT `resolveOAuthSession`, which gates
 *     on account-policy success and would skip the revoke for a locked account):
 *     readSessionToken → verifySessionToken → hashSecret → sessions.findByTokenHash → revoke.
 *  2. CSRF defense-in-depth: only perform the destructive revoke for a real top-level navigation —
 *     `Sec-Fetch-Mode` ABSENT (legacy/non-browser → degrade-open) OR `navigate`. A present header
 *     that is not `navigate` (e.g. `no-cors` from an <img> CSRF/prefetch vector) skips the revoke.
 *     Cookies are ALWAYS cleared (harmless, idempotent). No POST / no id_token_hint requirement.
 *  3. C1 post-logout redirect: only to a `post_logout_redirect_uri` that is REGISTERED in the
 *     resolved client's `redirectUris` (same guards as authorize). The client is resolved from
 *     `client_id` (preferred) else the `aud` of a SIGNATURE-VERIFIED `id_token_hint`. Any failure
 *     → minimal logged-out HTML (200), never a redirect to an unvalidated URI (no open redirect).
 */
export const createOAuthEndSessionHandler =
  (options: OAuthEndSessionHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const { ports } = options;

    // 1 + 2 — revoke the local session (CSRF-guarded), always clear cookies.
    const secFetchMode = c.req.header('sec-fetch-mode');
    const allowRevoke = secFetchMode === undefined || secFetchMode === 'navigate';
    let revoked = false;
    if (allowRevoke) {
      revoked = await revokeLocalSession(ports, c.req.raw);
    }

    // Always clear both cookies (idempotent, harmless). Set BEFORE building the response so the
    // Set-Cookie headers are copied into the 200/302 the helpers emit.
    appendClearedCookies(c, ports);

    // 3 — resolve a client to authorize the post-logout redirect (C1).
    const postLogoutRedirectUri = c.req.query('post_logout_redirect_uri');
    const state = c.req.query('state') ?? null;
    const clientId = c.req.query('client_id') ?? null;
    let redirected = false;

    if (postLogoutRedirectUri) {
      const client = await resolveLogoutClient(options, clientId, c.req.query('id_token_hint') ?? null);
      const valid = client ? validateRedirectUri(client, postLogoutRedirectUri) === null : false;
      if (client && valid) {
        redirected = true;
        void ports.auditLog?.record('info', 'oauth.end_session', { clientId, redirected, revoked });
        return c.redirect(appendParams(postLogoutRedirectUri, { state }, c.req.url), 302);
      }
    }

    void ports.auditLog?.record('info', 'oauth.end_session', { clientId, redirected, revoked });
    return c.html(LOGGED_OUT_HTML, 200);
  };

/**
 * Low-level local-session revoke (deliberately NOT `resolveOAuthSession`). Returns whether a
 * matching, consistent session record was found and revoked. Best-effort: any missing token,
 * invalid signature, or absent session record is a no-op (idempotent logout).
 */
const revokeLocalSession = async (ports: AuthHonoPorts, request: Request): Promise<boolean> => {
  const token = ports.cookies.readSessionToken(request);
  if (!token) return false;

  const claims = await ports.tokens.verifySessionToken(token);
  if (!claims) return false;

  const tokenHash = await ports.tokens.hashSecret(token);
  const sessionRecord = await ports.sessions.findByTokenHash(tokenHash);
  if (!sessionRecord || sessionRecord.id !== claims.sessionId || sessionRecord.userId !== claims.userId) {
    return false;
  }

  return ports.sessions.revoke(sessionRecord.id);
};

const appendClearedCookies = (c: Context, ports: AuthHonoPorts): void => {
  c.header('Set-Cookie', ports.cookies.serializeClearedSessionCookie(), { append: true });
  c.header('Set-Cookie', ports.cookies.serializeClearedRefreshCookie(), { append: true });
};

/**
 * Resolve the client whose `redirectUris` allowlist authorizes the post-logout redirect:
 * `client_id` takes precedence; otherwise the `aud` of a SIGNATURE-VERIFIED `id_token_hint`.
 * An unverified or malformed hint yields no client (the redirect then falls back to the
 * logged-out page).
 */
const resolveLogoutClient = async (
  options: OAuthEndSessionHandlerOptions,
  clientId: string | null,
  idTokenHint: string | null
): Promise<OauthClientRecord | null> => {
  if (clientId) {
    return options.ports.oauthStateStore.findClient(clientId);
  }
  if (!idTokenHint) return null;

  const audience = await verifyIdTokenHintAudience(options, idTokenHint);
  if (!audience) return null;
  return options.ports.oauthStateStore.findClient(audience);
};

const verifyIdTokenHintAudience = async (
  options: OAuthEndSessionHandlerOptions,
  idTokenHint: string
): Promise<string | null> => {
  try {
    const jwks = createJwksService({ clock: options.ports.clock, jwksPort: options.ports.jwks });
    const { payload } = await jwks.verifyJwt(idTokenHint, { issuer: options.issuer });
    if (typeof payload.aud === 'string') return payload.aud;
    if (Array.isArray(payload.aud) && payload.aud.length === 1 && typeof payload.aud[0] === 'string') {
      return payload.aud[0];
    }
    return null;
  } catch {
    return null;
  }
};
