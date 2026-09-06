// PLACEHOLDER LOCATION (BR-39m / fork F5): the standalone IdP service name,
// directory, and domain are NOT yet user-validated. `apps/auth-idp/`,
// service alias `auth-idp`, and domain `auth.sent-tech.ca` are provisional and
// MUST be confirmed with the user before merge (feedback_no_unvalidated_naming).
//
// Phase A0 (BR-39m): a THIN standalone IdP composition that REUSES the existing
// auth surface with ZERO new auth code. It mounts the reusable Cluster Mesh
// auth, session, and OAuth modules — all backed by the shared-DB Postgres
// adapters and the JWKS adapter — onto a fresh Hono app.
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
import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';

import { env } from '../../api/src/config/env';
import { applyAuthRateLimiters } from '../../api/src/middleware/auth-rate-limiters';
import { isOriginAllowed, parseAllowedOrigins } from '../../api/src/utils/cors';
import { clusterMeshAdapter } from '../../api/src/services/cluster-mesh-adapter';
import { createIdpSessionModule } from '../../api/src/routes/namespaces/session';
import {
  createOAuthNamespaceModule,
  createOAuthWellKnownProjection,
} from '../../api/src/routes/namespaces/oauth';
import { idpAuthPlugin } from '../../api/src/routes/namespaces/auth';

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
 * Rate limiting: this app builds its OWN `new Hono()` and mounts the auth module
 * directly, so limiters declared only on the product app in `api/src/app.ts` are
 * NEVER applied here — a previous comment claimed otherwise and was wrong. Since
 * `auth.sent-tech.ca` is a PUBLIC host serving
 * `/api/v1/auth/{login,register,magic-link}/*` against the same `users` table,
 * that left it with unlimited brute-force exposure. The limiters now live in
 * `api/src/middleware/auth-rate-limiters.ts` and are applied by BOTH apps, so the
 * two surfaces cannot drift apart again.
 */
export const createIdpApp = (): Hono => {
  const app = new Hono();
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  // Security headers: same posture as the product API. CORP/COEP stay off so
  // legitimate cross-origin RP requests (design-system origin -> IdP origin)
  // are not blocked; CORS below restricts credentials to allowed origins.
  //
  // The IdP now serves its OWN HTML + /_app assets (A0-bis). `upgrade-insecure-
  // requests` and HSTS are HTTPS-only hardening: over a plain-HTTP dev/test
  // origin `upgrade-insecure-requests` rewrites every subresource to https://
  // and breaks the served screens. So we emit BOTH only in production (the
  // public IdP at https://auth.sent-tech.ca stays fully hardened, unchanged).
  const isProduction = env.NODE_ENV === 'production';
  const contentSecurityPolicy = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'", 'https://*.sent-tech.ca'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    // The consent decision is a native-form POST whose server 302 lands on the RP's (cross-origin)
    // redirect_uri; form-action is enforced across that redirect, so 'self' alone would block it.
    // OAuth safety here is the server-side registered-redirect_uri validation, not CSP — so we
    // allow https RP origins (+ localhost RPs in non-prod). (BR-39r consent fix.)
    formAction: ["'self'", 'https:', ...(isProduction ? [] : ['http://localhost:*', 'http://127.0.0.1:*'])],
    frameAncestors: ["'none'"],
    ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
  };
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy,
      ...(isProduction
        ? { strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload' }
        : {}),
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
  // Same limiters as the product API (shared module, not a copy) — this public
  // host had none at all before.
  applyAuthRateLimiters(app);

  app.route('/.well-known', createOAuthWellKnownProjection({
    compositionRoot: 'auth-idp',
    publicPath: '/api/v1/auth/oauth',
  }));
  const authPlugin = idpAuthPlugin();
  app.route('/api/v1/auth', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [
      createIdpSessionModule(),
      createOAuthNamespaceModule({
        compositionRoot: 'auth-idp',
        publicPath: '/api/v1/auth/oauth',
      }),
      authPlugin.module,
    ],
    mounts: { '/session': '/', '/auth': authPlugin.mount },
  }));

  // Lightweight liveness/identity endpoint (kept off the SPA root path).
  app.get('/healthz', (c) =>
    c.json({ name: 'Sentropic IdP (PLACEHOLDER auth-idp)', phase: 'A0-bis', version: '0.0.0' }),
  );

  // Serve the built static front (login/register/magic-link/consent screens)
  // same-origin with the OIDC API. Hashed assets under /_app are immutable.
  app.use('/_app/*', serveStatic({ root: IDP_WEB_BUILD_DIR }));
  // Root-level assets from `web/static/` are NOT under /_app (they keep their plain names), so
  // each one needs its own route: anything not matched here falls through to the SPA fallback
  // below and is answered with `404.html`, i.e. HTML where the browser expects an image — which
  // renders as a broken-image placeholder rather than as a visible 404.
  //
  // That is what happened to the brand mark: `+layout.svelte:27` asks for /SENT-logo-squared.svg,
  // the file ships correctly in the build, and it was simply never routed. The bug was present in
  // every tier from the start, production included. `favicon.ico` had already hit it and was
  // patched file-by-file — the same trap, one file earlier.
  //
  // Kept file-by-file rather than serving the build root wholesale: a broad `serveStatic` here
  // would also start answering route paths with prerendered HTML instead of the SPA fallback, and
  // changing how the production auth screens resolve is not a change this fix should smuggle in.
  // `web/static/` holds exactly these two files today; a third one needs a line here too.
  app.use('/favicon.ico', serveStatic({ path: join(IDP_WEB_BUILD_DIR, 'favicon.ico') }));
  app.use(
    '/SENT-logo-squared.svg',
    serveStatic({ path: join(IDP_WEB_BUILD_DIR, 'SENT-logo-squared.svg') }),
  );

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
