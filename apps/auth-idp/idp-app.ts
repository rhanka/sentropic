// PLACEHOLDER LOCATION (BR-39m / fork F5): the standalone IdP service name,
// directory, and domain are NOT yet user-validated. `apps/auth-idp/`,
// service alias `auth-idp`, and domain `auth.sent-tech.ca` are provisional and
// MUST be confirmed with the user before merge (feedback_no_unvalidated_naming).
//
// Phase A0 (BR-39m): a THIN standalone IdP composition that REUSES the existing
// auth surface with ZERO new auth code. It mounts the already-wired
// `authRouter` (OAuth + register/login/session/consent handlers) and
// `wellKnownRouter` (openid-configuration + jwks) — both of which already
// compose `@sentropic/auth-hono` factories + the shared-DB Postgres adapters +
// the JWKS adapter — onto a fresh Hono app.
//
// SHARED PHYSICAL DB (fork F1+F3 default): this module imports the SAME db
// client and routers used by `api/`. It does NOT create a new database, does
// NOT run a new migration, and does NOT move/alter `users`/`user_sessions`.
// The physical `users` extraction + main-app OIDC cutover are deferred to
// Phase D. The IdP is the LOGICAL owner of identity while sharing the physical
// store with the product app.
//
// Reversibility: deleting `apps/auth-idp/` removes the standalone shell with no
// schema/data side effects. The product API (`api/src/app.ts`) is untouched and
// keeps serving the same auth surface in-app.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { env } from '../../api/src/config/env';
import { authRouter } from '../../api/src/routes/auth';
import { wellKnownRouter } from '../../api/src/routes/well-known';
import { isOriginAllowed, parseAllowedOrigins } from '../../api/src/utils/cors';

// BR-39m A0-bis — the human-facing login/register/magic-link/consent screens are
// a minimal SvelteKit static front (apps/auth-idp/web) built to `web/build` with
// the SPA fallback `404.html`. The IdP serves that bundle SAME-ORIGIN with its
// OIDC API so the session cookie is first-party at the IdP origin. Path resolved
// from cwd (`/workspace` in the dev image; configurable via IDP_WEB_BUILD_DIR).
const IDP_WEB_BUILD_DIR = process.env.IDP_WEB_BUILD_DIR ?? 'apps/auth-idp/web/build';
const SPA_FALLBACK_FILE = '404.html';

const readSpaFallback = (): string | null => {
  try {
    return readFileSync(join(process.cwd(), IDP_WEB_BUILD_DIR, SPA_FALLBACK_FILE), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Build the standalone IdP Hono application.
 *
 * The mounted paths intentionally mirror the product API so that existing
 * discovery, `@sentropic/auth-hono` factories, and `@sentropic/auth-ui`
 * clients work unchanged against the IdP origin:
 *   - GET  /.well-known/openid-configuration
 *   - GET  /.well-known/jwks.json
 *   - *    /api/v1/auth/oauth/*        (authorize, token, userinfo, consent, revoke, introspect)
 *   - *    /api/v1/auth/{register,login,session,credentials,magic-link,email,device}/*
 *
 * Rate limiting is intentionally NOT re-declared here: in Phase A0 the IdP is
 * run from the existing api image/entrypoint and the per-route limiters in
 * `api/src/app.ts` apply. Public-IdP abuse posture (trusted-proxy/XFF, tighter
 * limits) is a deploy-time concern tracked in the spec (§5.3) for `k8s-ops`.
 */
export const createIdpApp = (): Hono => {
  const app = new Hono();
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  // Security headers: same posture as the product API. CORP/COEP stay off so
  // legitimate cross-origin RP requests (design-system origin -> IdP origin)
  // are not blocked; CORS below restricts credentials to allowed origins.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'https://*.sent-tech.ca'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
      strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      xXssProtection: '1; mode=block',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );

  // Strict CORS with credentials, mirroring api/src/app.ts so RP browser flows
  // (cross-subdomain) and discovery fetches behave identically at the IdP origin.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const method = c.req.method;

    if (method === 'OPTIONS') {
      if (origin && isOriginAllowed(origin, allowedOrigins)) {
        const requestedHeaders = c.req.header('Access-Control-Request-Headers');
        const allowHeaders = requestedHeaders
          ? requestedHeaders
              .split(',')
              .map((h) => h.trim())
              .filter(Boolean)
              .join(',')
          : 'Content-Type,Authorization,X-App-Locale';
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        c.header('Access-Control-Allow-Headers', allowHeaders);
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Max-Age', '86400');
      }
      return c.body(null, 204);
    }

    await next();

    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  });

  // Reuse the EXISTING routers — no new auth code, no forked handlers.
  // Mounted BEFORE the static front so the API/discovery surface always wins.
  app.route('/.well-known', wellKnownRouter);
  app.route('/api/v1/auth', authRouter);

  // Lightweight liveness/identity endpoint (kept off the SPA root path).
  app.get('/healthz', (c) =>
    c.json({ name: 'Sentropic IdP (PLACEHOLDER auth-idp)', phase: 'A0-bis', version: '0.0.0' }),
  );

  // Serve the built static front (login/register/magic-link/consent screens)
  // same-origin with the OIDC API. Hashed assets under /_app are immutable.
  app.use('/_app/*', serveStatic({ root: IDP_WEB_BUILD_DIR }));
  app.use('/favicon.ico', serveStatic({ path: join(IDP_WEB_BUILD_DIR, 'favicon.ico') }));

  // SPA fallback: any other GET (e.g. /auth/login, /auth/oauth/consent) returns
  // the static `404.html` entry so client-side routing can take over. API and
  // well-known routes are already matched above, so they never reach this.
  const spaFallback = readSpaFallback();
  app.get('*', (c) => {
    if (!spaFallback) {
      return c.json(
        { name: 'Sentropic IdP (PLACEHOLDER auth-idp)', phase: 'A0-bis', screens: 'not_built' },
        200,
      );
    }
    return c.html(spaFallback);
  });

  return app;
};
