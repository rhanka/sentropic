import type { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

import { env } from '../config/env';
import { resolveClientIp } from '../utils/client-ip';

/**
 * Auth rate limiters, shared by every app that mounts a router from `createAuthRouter`.
 *
 * These MUST live outside `api/src/app.ts`: the standalone IdP
 * (`apps/auth-idp/idp-app.ts`) builds its own `new Hono()` and mounts the factory router
 * directly, so it never instantiates the product app. Declaring the limiters only
 * on the product app left `auth.sent-tech.ca` — a public host serving
 * `/api/v1/auth/{login,register,magic-link}/*` against the same `users` table —
 * with no rate limiting at all.
 *
 * Keys come from `resolveClientIp`, never from a raw `X-Forwarded-For` read: that
 * header is caller-controlled unless a proxy we operate overwrites it, so keying on
 * it lets a caller mint a fresh bucket per request.
 */

const ipKey = (c: Parameters<Parameters<typeof rateLimiter>[0]['keyGenerator']>[0]) =>
  resolveClientIp(c as never);

export const authSessionRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 30, // very permissive: session checks fire on every page load
  standardHeaders: 'draft-7',
  keyGenerator: ipKey,
});

export const authLoginRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: 'draft-7',
  keyGenerator: ipKey,
});

export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  keyGenerator: ipKey,
});

export const authRegisterRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  standardHeaders: 'draft-7',
  keyGenerator: ipKey,
});

export const magicLinkRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3,
  standardHeaders: 'draft-7',
  keyGenerator: ipKey,
});

export const oauthTokenRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => `${c.req.query('client_id') || 'unknown-client'}:${resolveClientIp(c as never)}`,
});

export const oauthIntrospectRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => `${c.req.query('client_id') || 'unknown-client'}:${resolveClientIp(c as never)}`,
});

/**
 * Register the auth limiters on an app that mounts a router from `createAuthRouter` under `/api/v1/auth`.
 * Order matters: most specific route first, the catch-all last.
 * No-op when `DISABLE_RATE_LIMIT` is set (test environments).
 */
export const applyAuthRateLimiters = (app: Hono): void => {
  if (env.DISABLE_RATE_LIMIT) return;

  app.use('/api/v1/oauth/token', oauthTokenRateLimiter);
  app.use('/api/v1/oauth/introspect', oauthIntrospectRateLimiter);
  app.use('/api/v1/oauth/*', authRateLimiter);
  app.use('/api/v1/auth/session*', authSessionRateLimiter);
  app.use('/api/v1/auth/login/*', authLoginRateLimiter);
  app.use('/api/v1/auth/register/*', authRegisterRateLimiter);
  app.use('/api/v1/auth/magic-link/*', magicLinkRateLimiter);
  app.use('/api/v1/auth/oauth/token', oauthTokenRateLimiter);
  app.use('/api/v1/auth/oauth/introspect', oauthIntrospectRateLimiter);
  // Device-code enrollment is polled at `interval` (default 5s) while pending, so it
  // needs the permissive limiter; per-code throttling/single-use/expiry is enforced
  // in the device-code store.
  app.use('/api/v1/auth/device/*', authSessionRateLimiter);
  // General auth routes last (excludes the already-matched routes above).
  app.use('/api/v1/auth/*', authRateLimiter);
};
