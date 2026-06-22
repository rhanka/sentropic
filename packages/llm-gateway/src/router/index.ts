/**
 * Gateway Hono router — the FROZEN v1 wire surface (spec §3, D7):
 *   POST /v1/messages            (Anthropic Messages compat)
 *   POST /v1/chat/completions    (OpenAI Chat Completions compat)
 *   GET  /v1/models              (filtered by caller/pool policy)
 *   GET  /healthz                (liveness — real)
 *   GET  /readyz                 (readiness — real; DB + secret-store + pool)
 *
 * v0 PERSONAL-PASSTHROUGH scaffold: health endpoints are real; the provider-
 * compat routes are TYPED STUBS returning provider-shaped 501 not-implemented
 * because their real dependencies (caller-auth via auth-hono, BR-47 metering,
 * KMS secret store, the llm-mesh dispatch wiring, cross-user authz) land in
 * later lots. The request flow they will follow is spec §2; the wire they
 * expose is spec §3b. NEVER expose pooled account ids/tokens/pool errors —
 * surface only provider-shaped availability/auth/rate-limit errors (spec §3).
 */

import { Hono } from 'hono';

import type { GatewayConfig } from '../config.js';
import { notImplemented } from './errors.js';

export interface ReadinessProbe {
  /** True when DB + secret-store + pool are all ready (spec §8 fail-closed). */
  isReady(): Promise<boolean>;
}

export interface CreateGatewayRouterOptions {
  readonly config: GatewayConfig;
  /** Optional readiness probe; defaults to always-ready in the v0 scaffold. */
  readonly readiness?: ReadinessProbe;
}

/**
 * Build the gateway Hono app. The provider-compat routes are mounted and
 * type-wired to `config`, but short-circuit to a provider-shaped 501 until the
 * concrete flow lands (Lot 2). This keeps the v1 surface FROZEN and mountable
 * now (spec §6: mountable into the api during transition) without shipping an
 * unfinished dispatch path.
 */
export const createGatewayRouter = ({
  config,
  readiness,
}: CreateGatewayRouterOptions): Hono => {
  const app = new Hono();

  // --- Health (real) ---
  app.get('/healthz', (c) => c.json({ status: 'ok', mode: config.mode }));

  app.get('/readyz', async (c) => {
    const ready = readiness ? await readiness.isReady() : true;
    return c.json({ status: ready ? 'ready' : 'not-ready' }, ready ? 200 : 503);
  });

  // --- Provider-compat wire (FROZEN v1 surface; v0 stubs) ---
  app.post('/v1/messages', (c) => {
    const err = notImplemented('anthropic-messages');
    return c.json(err.body as object, err.status as 501);
  });

  app.post('/v1/chat/completions', (c) => {
    const err = notImplemented('openai-chat-completions');
    return c.json(err.body as object, err.status as 501);
  });

  app.get('/v1/models', (c) => {
    // Filtered by caller/pool policy (spec §3); empty list in the v0 scaffold.
    return c.json({ object: 'list', data: [] as unknown[] });
  });

  return app;
};
