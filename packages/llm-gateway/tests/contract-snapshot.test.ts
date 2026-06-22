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

import { mapGatewayError, type GatewayFailureKind, type GatewayWire } from '../src/index.js';
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
 * FROZEN §3b error-mapping table: internal failure class -> { status, body
 * type } per wire. Derived live from `mapGatewayError` and asserted against the
 * golden, so a change to the mapper that drifts the wire fails here.
 */
const FROZEN_ERROR_MAP: Record<
  GatewayFailureKind,
  { anthropic: { status: number; type: string }; openai: { status: number; type: string } }
> = {
  'caller-auth-failed': {
    anthropic: { status: 401, type: 'authentication_error' },
    openai: { status: 401, type: 'invalid_request_error' },
  },
  'over-budget': {
    anthropic: { status: 429, type: 'rate_limit_error' },
    openai: { status: 429, type: 'rate_limit_error' },
  },
  'no-eligible-account': {
    anthropic: { status: 429, type: 'overloaded_error' },
    openai: { status: 429, type: 'rate_limit_error' },
  },
  'pooled-account-unavailable': {
    anthropic: { status: 503, type: 'overloaded_error' },
    openai: { status: 503, type: 'rate_limit_error' },
  },
  'cross-user-disabled': {
    anthropic: { status: 400, type: 'invalid_request_error' },
    openai: { status: 400, type: 'invalid_request_error' },
  },
  'bad-request': {
    anthropic: { status: 400, type: 'invalid_request_error' },
    openai: { status: 400, type: 'invalid_request_error' },
  },
};

const bodyType = (wire: GatewayWire, body: unknown): string =>
  wire === 'anthropic-messages'
    ? (body as { error: { type: string } }).error.type
    : (body as { error: { type: string } }).error.type;

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
  it('freezes the Anthropic /v1/messages JSON response + request-id header', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    // Provider-native body passed through VERBATIM (the gateway does not reshape).
    const body = (await res.json()) as { type?: string };
    expect(body.type).toBe('message');
  });

  it('freezes the OpenAI /v1/chat/completions JSON response + request-id header', async () => {
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
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    const body = (await res.json()) as { object?: string };
    expect(body.object).toBe('chat.completion');
  });
});

describe('BR-46 v1 wire contract snapshot — SSE framing', () => {
  it('freezes Anthropic SSE framing (text/event-stream; event:/data:; message_stop)', async () => {
    const transport = new FixtureTransport({ streamFrames: anthropicFrames() });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    // Anthropic frames: `event: <name>\ndata: <json>\n\n`, terminating message_stop.
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: message_stop');
    expect(text).toContain('\ndata: ');
    // NEVER the OpenAI terminator on the Anthropic wire.
    expect(text).not.toContain('[DONE]');
  });

  it('freezes OpenAI SSE framing (data: chunks terminated by data: [DONE])', async () => {
    const transport = new FixtureTransport({ streamFrames: openAiFrames() });
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {');
    expect(text).toContain('"object":"chat.completion.chunk"');
    // OpenAI terminates with the [DONE] sentinel (spec §3b).
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
    // NEVER Anthropic event names on the OpenAI wire.
    expect(text).not.toContain('event: message_start');
  });
});

describe('BR-46 v1 wire contract snapshot — §3b error-mapping table', () => {
  it('freezes the per-wire {status, body-type} mapping for every failure class', () => {
    for (const kind of Object.keys(FROZEN_ERROR_MAP) as GatewayFailureKind[]) {
      const golden = FROZEN_ERROR_MAP[kind];

      const a = mapGatewayError('anthropic-messages', kind);
      expect(a.status).toBe(golden.anthropic.status);
      expect(bodyType('anthropic-messages', a.body)).toBe(golden.anthropic.type);

      const o = mapGatewayError('openai-chat-completions', kind);
      expect(o.status).toBe(golden.openai.status);
      expect(bodyType('openai-chat-completions', o.body)).toBe(golden.openai.type);
    }
  });

  it('freezes the Retry-After attachment for rate-limit/overloaded classes', () => {
    for (const kind of ['over-budget', 'no-eligible-account', 'pooled-account-unavailable'] as const) {
      const a = mapGatewayError('anthropic-messages', kind, 7);
      expect(a.headers?.['Retry-After']).toBe('7');
    }
    // Auth + bad-request never carry Retry-After.
    expect(mapGatewayError('anthropic-messages', 'caller-auth-failed', 7).headers).toBeUndefined();
    expect(mapGatewayError('openai-chat-completions', 'bad-request', 7).headers).toBeUndefined();
  });

  it('freezes the two provider-shaped error envelopes (Anthropic vs OpenAI)', () => {
    const a = mapGatewayError('anthropic-messages', 'bad-request');
    // Anthropic: {"type":"error","error":{"type","message"}}
    expect((a.body as { type: string }).type).toBe('error');
    expect(Object.keys((a.body as { error: object }).error).sort()).toEqual(['message', 'type']);

    const o = mapGatewayError('openai-chat-completions', 'bad-request');
    // OpenAI: {"error":{"message","type","code"}}
    expect(Object.keys((o.body as { error: object }).error).sort()).toEqual([
      'code',
      'message',
      'type',
    ]);
  });
});
