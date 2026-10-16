/**
 * Owner-UAT integration — the three CLI wires over real HTTP (Lot N).
 *
 * Boots the real router behind `node:http` on ephemeral ports and drives the
 * owner scenarios with fixture pools + a stubbed mesh planner — no network,
 * no secrets, no enrollments. Frozen contracts asserted (spec §15, Lots 1/7):
 * - no eligible account at all -> 429 `no-eligible-account` (never mute);
 * - planner no-route with per-transport diagnostics -> 503 with the joined
 *   causes in the body (Lot 7 anti-mute);
 * - planner no-route carrying the reauth-required diagnostic -> 503 with the
 *   `X-Sentropic-Route-Action` header (Gap 1 expiry shape);
 * - caller auth gates before any pool or planner touch (401).
 */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutePlanError } from '@sentropic/llm-mesh';

import {
  createGatewayRouter,
  PersonalPassthroughCallerAuth,
  stubGatewayConfig,
  VerifiedCostContextResolver,
} from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { anthropicRequest } from './fixtures/anthropic.js';
import { openAiRequest } from './fixtures/openai.js';
import {
  authHeaders,
  buildHarness,
  twoAccountPool,
} from './fixtures/harness.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(
    (server) => new Promise<void>((resolve) => server.close(() => resolve())),
  ));}
);

const serve = async (app: { fetch: (request: Request) => Response | Promise<Response> }) => {
  const server = createServer(async (req, res) => {
    const rawBody = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const url = `http://127.0.0.1${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const response = await app.fetch(new Request(url, {
      method: req.method,
      headers,
      body: rawBody.length > 0 ? rawBody : undefined,
    }));
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ephemeral port unavailable');
  servers.push(server);
  return `http://127.0.0.1:${address.port}`;
};

/** Gateway app on the mesh-planner path with a stubbed plan outcome. */
const plannerApp = (plan: () => Promise<never>) => {
  const verify = vi.fn(() => ({
    tenantId: 't', principalId: 'user-a', source: 'test', ownerScopeRef: 'enrolled:user-a',
  }));
  return createGatewayRouter({
    config: {
      ...stubGatewayConfig,
      callerAuth: new PersonalPassthroughCallerAuth({
        verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver(),
      }),
    },
    routePlanner: { plan } as never,
    routeMetering: { settleRoute: vi.fn() } as never,
    requestId: () => 'owner-uat-req',
  });
};

const expiredDiagnostic = {
  code: 'reauth-required' as const,
  transportProviderId: 'claude-code',
  message: 'claude-code credential expired at 2020-01-01T00:00:00.000Z;'
    + ' reauthenticate the claude-code account to restore routing',
};

describe('owner UAT over real HTTP (no enrollments)', () => {
  it('should answer vibe mistral-medium-3.5 with the frozen 429 when no account is eligible', async () => {
    const { app } = buildHarness({
      transport: new FixtureTransport(),
      accounts: twoAccountPool().filter((a) => a.transportProviderId === 'claude-code'),
    });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ ...openAiRequest(false), model: 'mistral-medium-3.5' }),
    });
    expect(res.status).toBe(429);
    const json = await res.json() as Record<string, any>;
    expect(json.error?.type).toBe('rate_limit_error');
    expect(json.error?.code).toBe('overloaded');
    expect(json.error?.message).toBe('service temporarily unavailable');
  });

  it('should answer muse claude-sonnet-4-6 with the frozen 429 on an empty pool', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport(), accounts: [] });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(429);
    const json = await res.json() as Record<string, any>;
    expect(json.error?.type).toBe('overloaded_error');
    expect(json.error?.message).toBe('service temporarily unavailable');
  });

  it('should answer cloud-code gemini-3.7-flash with the frozen 429 on an empty pool', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport(), accounts: [] });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ ...openAiRequest(false), model: 'gemini-3.7-flash' }),
    });
    expect(res.status).toBe(429);
    const json = await res.json() as Record<string, any>;
    expect(json.error?.code).toBe('overloaded');
  });

  it('should gate the vibe wire at caller auth before any pool touch', async () => {
    const { app } = buildHarness({
      transport: new FixtureTransport(),
      accounts: twoAccountPool().filter((a) => a.transportProviderId === 'claude-code'),
    });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer REDACTED', 'content-type': 'application/json' },
      body: JSON.stringify({ ...openAiRequest(false), model: 'mistral-medium-3.5' }),
    });
    expect(res.status).toBe(401);
  });

  it('should join planner no-route diagnostics into the vibe 503 body', async () => {
    const app = plannerApp(async () => {
      throw new RoutePlanError('Route quote has no candidates', 'no-route', undefined, [
        { code: 'reauth-required', transportProviderId: 'mistral-vibe', message: 'mistral-vibe credential expired; reauthenticate the mistral-vibe account to restore routing' },
        { code: 'reauth-required', transportProviderId: 'codex', message: 'codex credential expired; reauthenticate the codex account to restore routing' },
      ]);
    });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
      body: JSON.stringify({ ...openAiRequest(false), model: 'mistral-medium-3.5' }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-should-retry')).toBe('false');
    const json = await res.json() as Record<string, any>;
    expect(json.error?.code).toBe('no_route');
    expect(json.error?.message).toContain('No route available for model: "mistral-medium-3.5"');
    expect(json.error?.message).toContain('mistral-vibe credential expired');
    expect(json.error?.message).toContain('codex credential expired');
  });

  it('should surface the reauth-required diagnostic with the route-action header on the muse wire', async () => {
    const app = plannerApp(async () => {
      throw new RoutePlanError(
        'claude-code credential expired at 2020-01-01T00:00:00.000Z',
        'no-route',
        expiredDiagnostic,
        [expiredDiagnostic],
      );
    });
    const base = await serve(app);
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-sentropic-route-action')).toBe('reauthenticate-claude-code');
    const json = await res.json() as Record<string, any>;
    expect(JSON.stringify(json)).toContain('reauthenticate the claude-code account');
  });
});
