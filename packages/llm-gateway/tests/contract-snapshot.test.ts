/**
 * BR-46 — v1 wire CONTRACT SNAPSHOT (Lot-3a freeze prep).
 *
 * Captures/freezes the v1 public wire surface so ANY future change to it is
 * detected by a failing test (the freeze MECHANISM; the SIGN is the gate). The
 * frozen surface = spec §3 / §3b:
 *   - the route inventory (`/v1/messages`, `/v1/chat/completions`, `/v1/models`,
 *     `/healthz`, `/readyz`) + methods,
 *   - the request/response/SSE FRAMING shapes (Anthropic event/data vs OpenAI
 *     `data:` + `[DONE]`; the `X-Sentropic-Request-Id` response header),
 *   - the §3b ERROR-MAPPING table (status + provider-shaped body type per wire).
 *
 * The wire is NOT "frozen-final" by this file's existence — that is the Lot-3
 * double-review (Opus 4.8max + Codex 5.5xhigh) + architect sign + owner
 * re-confirm. This snapshot is the detector those reviewers ratify against.
 *
 * Golden objects are inline + literal: an intentional wire change requires
 * editing this golden in the SAME PR (visible in review), never silently.
 */

import { describe, expect, it } from 'vitest';

import { mapGatewayError, type GatewayFailureKind } from '../src/index.js';
import { FixtureTransport, anthropicFrames, openAiFrames } from './fixtures/transport.js';
import { buildHarness, authHeaders } from './fixtures/harness.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';
import { openAiChatResponse, openAiRequest } from './fixtures/openai.js';

const REQUEST_ID_HEADER = 'x-sentropic-request-id';

/**
 * FROZEN v1 route inventory (spec §3, D6). Adding/removing/renaming a route or
 * changing its method here is a v1 wire change — it MUST go through the
 * contract review + a deliberate edit of this golden.
 */
const FROZEN_ROUTES = [
  { method: 'POST', path: '/v1/messages', wire: 'anthropic-messages' },
  { method: 'POST', path: '/v1/chat/completions', wire: 'openai-chat-completions' },
  { method: 'GET', path: '/v1/models' },
  { method: 'GET', path: '/healthz' },
  { method: 'GET', path: '/readyz' },
] as const;

/**
 * FROZEN §3b error-mapping table: internal failure class -> the EXACT provider
 * envelope (status + full body + code + message) per wire. Derived live from
 * `mapGatewayError` and asserted against this golden, so ANY drift in status,
 * type, code OR message text fails here. Anthropic body = `{type:'error',
 * error:{type,message}}`; OpenAI body = `{error:{message,type,code?}}`.
 */
const FROZEN_ERROR_MAP: Record<
  GatewayFailureKind,
  {
    anthropic: { status: number; type: string; message: string };
    openai: { status: number; type: string; message: string; code: string };
  }
> = {
  'caller-auth-failed': {
    anthropic: { status: 401, type: 'authentication_error', message: 'authentication failed' },
    openai: { status: 401, type: 'invalid_request_error', message: 'authentication failed', code: 'invalid_api_key' },
  },
  'over-budget': {
    anthropic: { status: 429, type: 'rate_limit_error', message: 'rate limit exceeded' },
    openai: { status: 429, type: 'rate_limit_error', message: 'rate limit exceeded', code: 'rate_limit_exceeded' },
  },
  'no-eligible-account': {
    anthropic: { status: 429, type: 'overloaded_error', message: 'service temporarily unavailable' },
    openai: { status: 429, type: 'rate_limit_error', message: 'service temporarily unavailable', code: 'overloaded' },
  },
  'pooled-account-unavailable': {
    anthropic: { status: 503, type: 'overloaded_error', message: 'service temporarily unavailable' },
    openai: { status: 503, type: 'rate_limit_error', message: 'service temporarily unavailable', code: 'overloaded' },
  },
  'cross-user-disabled': {
    anthropic: { status: 400, type: 'invalid_request_error', message: 'request not permitted' },
    openai: { status: 400, type: 'invalid_request_error', message: 'request not permitted', code: 'unsupported' },
  },
  'bad-request': {
    anthropic: { status: 400, type: 'invalid_request_error', message: 'invalid request' },
    openai: { status: 400, type: 'invalid_request_error', message: 'invalid request', code: 'invalid_request' },
  },
};

/** The actual (method, path) pairs registered on the real Hono router. */
const actualRouterRoutes = (app: { routes: { method: string; path: string }[] }): string[] => {
  const seen = new Set<string>();
  for (const r of app.routes) {
    // Skip Hono framework middleware entries (`ALL` method / wildcard paths).
    if (r.method === 'ALL' || r.path === '*' || r.path === '/*') {
      continue;
    }
    seen.add(`${r.method} ${r.path}`);
  }
  return [...seen].sort();
};

describe('BR-46 v1 wire contract snapshot — route inventory', () => {
  it('freezes the exact v1 route inventory + methods (spec §3)', () => {
    // The inventory itself is the snapshot: count + each (method, path) pair.
    expect(FROZEN_ROUTES).toHaveLength(5);
    expect(FROZEN_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/messages',
      'POST /v1/chat/completions',
      'GET /v1/models',
      'GET /healthz',
      'GET /readyz',
    ]);
  });

  it('UNKNOWN-ROUTE GUARD: the REAL router exposes EXACTLY the frozen routes', () => {
    // Derived live from the mounted Hono router. Adding/removing/renaming ANY
    // route (or changing its method) makes this FAIL until the FROZEN_ROUTES
    // golden is deliberately edited in the same PR — a real freeze, not a
    // hand-written constant that can silently drift from the router.
    const { app } = buildHarness({ transport: new FixtureTransport() });
    const expected = FROZEN_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(actualRouterRoutes(app)).toEqual(expected);
  });

  it('mounts every frozen route (no 404) on the real router', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport() });
    for (const route of FROZEN_ROUTES) {
      const res = await app.request(route.path, {
        method: route.method,
        ...(route.method === 'POST'
          ? { headers: authHeaders('user-a'), body: JSON.stringify({ model: 'x', messages: [] }) }
          : {}),
      });
      // Mounted = anything but a 404. (Behaviour per route is asserted below.)
      expect(res.status).not.toBe(404);
    }
  });
});

describe('BR-46 v1 wire contract snapshot — health surface', () => {
  it('freezes /healthz body shape', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport() });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', mode: 'personal-passthrough' });
  });

  it('freezes /readyz body shape (ready)', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport() });
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });
});

describe('BR-46 v1 wire contract snapshot — /v1/models shape', () => {
  it('freezes the OpenAI-list model catalog shape (spec §3)', async () => {
    const { app } = buildHarness({ transport: new FixtureTransport() });
    const res = await app.request('/v1/models', { headers: authHeaders('user-a') });
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    const body = (await res.json()) as {
      object: string;
      data: { id: string; object: string; owned_by: string }[];
    };
    expect(body.object).toBe('list');
    // Each entry is the frozen {id, object:'model', owned_by} shape — NEVER an
    // account id/token (spec §3 — filtered by caller/pool policy).
    for (const entry of body.data) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'object', 'owned_by']);
      expect(entry.object).toBe('model');
      expect(JSON.stringify(entry)).not.toContain('acct-');
      expect(JSON.stringify(entry)).not.toContain('SECRET');
    }
  });
});

describe('BR-46 v1 wire contract snapshot — non-stream JSON passthrough', () => {
  it('freezes the EXACT Anthropic /v1/messages status + body + request-id header', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    // EXACT status.
    expect(res.status).toBe(200);
    // EXACT gateway request-id header (the harness pins it deterministically).
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('req_fixture_id');
    // EXACT provider-native body, byte-faithful (the gateway does NOT reshape).
    const body = await res.json();
    expect(body).toEqual(anthropicMessageResponse);
  });

  it('freezes the EXACT OpenAI /v1/chat/completions status + body + request-id header', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: openAiChatResponse },
    });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(false)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('req_fixture_id');
    const body = await res.json();
    expect(body).toEqual(openAiChatResponse);
  });
});

describe('BR-46 v1 wire contract snapshot — SSE framing', () => {
  it('freezes the EXACT Anthropic SSE bytes (event:/data: ... message_stop, NO [DONE])', async () => {
    const frames = anthropicFrames();
    const transport = new FixtureTransport({ streamFrames: frames });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const text = await res.text();
    // EXACT bytes: relayed stream EQUALS the provider frames verbatim (no synth).
    expect(text).toBe(frames.join(''));
    // Anthropic terminates with message_stop and carries NO [DONE] (B3).
    expect(text.endsWith('event: message_stop\ndata: {"type":"message_stop"}\n\n')).toBe(true);
    expect(text).not.toContain('[DONE]');
  });

  it('freezes the EXACT OpenAI SSE bytes (data: chunks + provider data: [DONE], exactly one)', async () => {
    const frames = openAiFrames(); // includes the provider's own data: [DONE]
    const transport = new FixtureTransport({ streamFrames: frames });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const text = await res.text();
    // EXACT bytes: relayed stream EQUALS the provider frames verbatim (B3 — the
    // gateway synthesizes NO terminator; the provider's single [DONE] is relayed).
    expect(text).toBe(frames.join(''));
    expect(text.split('data: [DONE]').length - 1).toBe(1);
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
    // NEVER Anthropic event names on the OpenAI wire.
    expect(text).not.toContain('event: message_start');
  });
});

describe('BR-46 v1 wire contract snapshot — §3b error-mapping table', () => {
  it('freezes the EXACT per-wire status + body (type, message, code) for every failure class', () => {
    for (const kind of Object.keys(FROZEN_ERROR_MAP) as GatewayFailureKind[]) {
      const golden = FROZEN_ERROR_MAP[kind];

      // Anthropic: EXACT status + full `{type:'error', error:{type,message}}`.
      const a = mapGatewayError('anthropic-messages', kind);
      expect(a.status).toBe(golden.anthropic.status);
      expect(a.body).toEqual({
        type: 'error',
        error: { type: golden.anthropic.type, message: golden.anthropic.message },
      });

      // OpenAI: EXACT status + full `{error:{message,type,code}}`.
      const o = mapGatewayError('openai-chat-completions', kind);
      expect(o.status).toBe(golden.openai.status);
      expect(o.body).toEqual({
        error: {
          message: golden.openai.message,
          type: golden.openai.type,
          code: golden.openai.code,
        },
      });
    }
  });

  it('freezes the EXACT Retry-After header for rate-limit/overloaded classes', () => {
    for (const kind of ['over-budget', 'no-eligible-account', 'pooled-account-unavailable'] as const) {
      const a = mapGatewayError('anthropic-messages', kind, 7);
      expect(a.headers).toEqual({ 'Retry-After': '7' });
      const o = mapGatewayError('openai-chat-completions', kind, 7);
      expect(o.headers).toEqual({ 'Retry-After': '7' });
    }
    // Auth + bad-request never carry Retry-After (no headers at all).
    expect(mapGatewayError('anthropic-messages', 'caller-auth-failed', 7).headers).toBeUndefined();
    expect(mapGatewayError('openai-chat-completions', 'bad-request', 7).headers).toBeUndefined();
  });

  it('freezes the two provider-shaped error envelope key-sets (Anthropic vs OpenAI)', () => {
    const a = mapGatewayError('anthropic-messages', 'bad-request');
    expect((a.body as { type: string }).type).toBe('error');
    expect(Object.keys((a.body as { error: object }).error).sort()).toEqual(['message', 'type']);

    const o = mapGatewayError('openai-chat-completions', 'bad-request');
    expect(Object.keys((o.body as { error: object }).error).sort()).toEqual([
      'code',
      'message',
      'type',
    ]);
  });
});
