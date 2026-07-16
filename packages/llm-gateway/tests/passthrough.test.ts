/**
 * Lot-2 integration tests: faithful provider-compat passthrough + error mapping
 * + redaction + sticky selection, against FIXTURES (no network, no docker).
 *
 * Covers both wires:
 *   - /v1/messages (Anthropic Messages)
 *   - /v1/chat/completions (OpenAI Chat Completions)
 */

import { describe, expect, it } from 'vitest';

import { parseSse } from '../src/index.js';
import {
  anthropicMessageResponse,
  anthropicRequest,
} from './fixtures/anthropic.js';
import { openAiChatResponse, openAiRequest } from './fixtures/openai.js';
import {
  FixtureTransport,
  anthropicFrames,
  anthropicFramesWithError,
  openAiFrames,
  openAiFramesWithError,
} from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';

const POOL_SECRETS = [
  'SECRET-ALPHA-TOKEN-xyz',
  'SECRET-ALPHA-REFRESH-xyz',
  'SECRET-BETA-TOKEN-xyz',
  'SECRET-BETA-REFRESH-xyz',
  'acct-alpha',
  'acct-beta',
];

const assertNoPoolSecrets = (text: string): void => {
  for (const secret of POOL_SECRETS) {
    expect(text).not.toContain(secret);
  }
};

describe('faithful non-stream passthrough', () => {
  it('relays the Anthropic Messages response body + status verbatim', async () => {
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
    const body = await res.json();
    // Byte-faithful: the provider-native JSON is returned unchanged.
    expect(body).toEqual(anthropicMessageResponse);
    // Gateway-added but invisible: only the request-id header.
    expect(res.headers.get('X-Sentropic-Request-Id')).toBe('req_fixture_id');
    // The pooled credential was swapped in (transport saw it), invisible on wire.
    expect(transport.seenMaterials).toHaveLength(1);
    assertNoPoolSecrets(JSON.stringify(body));
  });

  it('relays the OpenAI Chat Completions response body + status verbatim', async () => {
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
    const body = await res.json();
    expect(body).toEqual(openAiChatResponse);
    assertNoPoolSecrets(JSON.stringify(body));
  });

  it('settles rate_limited (not failed) when the provider returns 429', async () => {
    const transport = new FixtureTransport({
      jsonResponse: {
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
      },
      responseHeaders: { 'retry-after': '30' },
    });
    const { app, metering } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    expect(res.status).toBe(429);
    // With retry-with-rotation, both pool accounts are tried (and both return 429).
    // The pool has 2 Claude-Code accounts: first settles rate_limited, retry
    // rotates to the second which also gets 429 and settles rate_limited.
    expect(metering.settlements).toHaveLength(2);
    expect(metering.settlements[0].outcome).toBe('rate_limited');
    expect(metering.settlements[1].outcome).toBe('rate_limited');
  });
});

describe('faithful SSE passthrough framing', () => {
  it('relays Anthropic SSE frames verbatim (message_start..message_stop)', async () => {
    const frames = anthropicFrames();
    const transport = new FixtureTransport({ streamFrames: frames });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    // The relayed bytes equal the joined native frames (faithful framing).
    expect(text).toBe(frames.join(''));

    const events = parseSse(text);
    expect(events.map((e) => e.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    // Anthropic stream has NO [DONE] terminator.
    expect(text).not.toContain('[DONE]');
    assertNoPoolSecrets(text);
  });

  it('relays OpenAI SSE chunks (incl. the provider [DONE]) verbatim, synthesizing none', async () => {
    // B3: the transport (a real OpenAI provider) emits its OWN data: [DONE]; the
    // gateway relays the bytes verbatim and adds NO terminator of its own.
    const frames = openAiFrames(); // includes the provider's data: [DONE]
    const transport = new FixtureTransport({ streamFrames: frames });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    // Byte-faithful: relayed bytes EQUAL the provider frames (no synthesized [DONE]).
    expect(text).toBe(frames.join(''));

    const events = parseSse(text);
    expect(events[0]?.data).toContain('chat.completion.chunk');
    expect(events.at(-1)?.data).toBe('[DONE]');
    assertNoPoolSecrets(text);
  });

  it('B3: provider already emits [DONE] -> EXACTLY ONE [DONE] (no double terminator)', async () => {
    const frames = openAiFrames(); // provider includes one data: [DONE]
    const transport = new FixtureTransport({ streamFrames: frames });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });
    const text = await res.text();
    // Exactly one [DONE] sentinel in the whole stream.
    expect(text.split('data: [DONE]').length - 1).toBe(1);
  });

  it('B3: mid-stream OpenAI error -> NO trailing synthetic [DONE]', async () => {
    // Provider chunks then a native error chunk, then the connection drops —
    // OpenAI does NOT emit [DONE] after a mid-stream error, and the gateway
    // must not synthesize one (it would mask the error as a clean stop).
    const frames = openAiFramesWithError();
    const transport = new FixtureTransport({
      streamFrames: frames,
      failAfterFrames: frames.length,
    });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });
    const text = await res.text();
    expect(text).toContain('server_error');
    // No synthetic [DONE] after the mid-stream error.
    expect(text).not.toContain('[DONE]');
  });
});

describe('no-retry-after-stream (spec §2)', () => {
  it('settles failure on mid-stream Anthropic provider error without retrying', async () => {
    const frames = anthropicFramesWithError();
    const transport = new FixtureTransport({
      streamFrames: frames,
      failAfterFrames: frames.length, // throw after the native error frame
    });
    const { app, metering } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });

    // Bytes already streamed -> 200 stream, native error frame relayed, no retry.
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    // The transport was invoked exactly once (no retry after bytes streamed).
    expect(transport.seenMaterials).toHaveLength(1);
    // The flow settled exactly once with a failure outcome.
    expect(metering.settlements).toHaveLength(1);
    expect(metering.last?.outcome).toBe('failed');
  });

  it('settles failure on mid-stream OpenAI provider error without retrying', async () => {
    const frames = openAiFramesWithError();
    const transport = new FixtureTransport({
      streamFrames: frames,
      failAfterFrames: frames.length,
    });
    const { app, metering } = buildHarness({ transport });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(true)),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('server_error');
    expect(transport.seenMaterials).toHaveLength(1);
    expect(metering.settlements).toHaveLength(1);
    expect(metering.last?.outcome).toBe('failed');
  });

  it('#6: a failure BEFORE the first byte returns 503, not an empty 200 stream', async () => {
    const transport = new FixtureTransport({ failBeforeFirstFrame: true });
    const { app, metering } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });

    // No byte streamed -> a real provider-shaped HTTP error, not an empty 200.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('overloaded_error');
    // The flow still settled exactly once (failure), and never leaks pool detail.
    expect(metering.settlements).toHaveLength(1);
    expect(metering.last?.outcome).toBe('failed');
    expect(JSON.stringify(body)).not.toContain('lease');
  });
});

describe('#4 provider response header passthrough', () => {
  it('forwards allowlisted provider headers on a non-stream response, drops the rest', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
      responseHeaders: {
        'anthropic-request-id': 'req_anthropic_abc',
        'anthropic-version': '2023-06-01',
        'retry-after': '3',
        // Off-allowlist / pool-leak risk headers MUST be dropped.
        'x-gateway-lease': 'lease_secret_1',
        'set-cookie': 'session=abc',
      },
    });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    expect(res.status).toBe(200);
    // Allowlisted provider headers forwarded.
    expect(res.headers.get('anthropic-request-id')).toBe('req_anthropic_abc');
    expect(res.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(res.headers.get('retry-after')).toBe('3');
    // Gateway request id always present.
    expect(res.headers.get('x-sentropic-request-id')).toBe('req_fixture_id');
    // Off-allowlist headers dropped (no pool internal rides out).
    expect(res.headers.get('x-gateway-lease')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('forwards allowlisted provider headers on a stream response', async () => {
    const transport = new FixtureTransport({
      streamFrames: anthropicFrames(),
      responseHeaders: { 'anthropic-request-id': 'req_stream_xyz', 'x-internal': 'nope' },
    });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(true)),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('anthropic-request-id')).toBe('req_stream_xyz');
    expect(res.headers.get('x-internal')).toBeNull();
    await res.text();
  });
});

describe('settlement + metering hook (spec §5)', () => {
  it('settles success with provider-reported usage on a non-stream call', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app, metering } = buildHarness({ transport });

    await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    expect(metering.settlements).toHaveLength(1);
    const settle = metering.last;
    expect(settle?.outcome).toBe('success');
    expect(settle?.usage).toEqual({ inputTokens: 12, outputTokens: 15, estimated: false });
    // The settle hook receives the REDACTED account view — never the token.
    expect(JSON.stringify(settle?.account)).not.toContain('SECRET-ALPHA-TOKEN-xyz');
    expect(settle?.account.hasRefreshToken).toBe(true);
  });

  it('B2: no leaseId / lease / raw account id reaches the metering record', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app, metering } = buildHarness({ transport });

    await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    // The whole settlement record (the metering surface) must carry NO pool id.
    const record = JSON.stringify(metering.settlements);
    expect(record).not.toContain('leaseId');
    expect(record).not.toContain('lease_');
    expect(record).not.toContain('lease');
    // The pool's raw account ids never reach the metering record.
    for (const secret of POOL_SECRETS) {
      expect(record).not.toContain(secret);
    }
    // The account view exposes only a gateway-local opaque correlation id.
    expect(metering.last?.account.correlationId.startsWith('gw_')).toBe(true);
  });
});

describe('retry-with-rotation on 429 (pre-stream)', () => {
  it('retries with a different account on 429 pre-stream (JSON path)', async () => {
    const transport = new FixtureTransport({
      jsonResponseSequence: [
        // First call: 429
        {
          status: 429,
          body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        },
        // Second call (after rotation): 200
        { status: 200, body: anthropicMessageResponse },
      ],
    });
    const { app, metering } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    // Should succeed after retry
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(anthropicMessageResponse);
    // Transport was called twice (429 + 200)
    expect(transport.seenMaterials).toHaveLength(2);
    // Metering should have two records: rate_limited + success
    expect(metering.settlements).toHaveLength(2);
    expect(metering.settlements[0].outcome).toBe('rate_limited');
    expect(metering.settlements[1].outcome).toBe('success');
  });

  it('returns 429 after pool exhausted on repeated 429s', async () => {
    const transport = new FixtureTransport({
      jsonResponseSequence: [
        { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } },
        { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } },
        { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } },
      ],
    });
    const { app } = buildHarness({ transport });

    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });

    // With a 2-account pool: first 429 rotates to the second, second 429 exhausts
    // the pool (both on cooldown), returns the 429.
    expect(res.status).toBe(429);
    // Both accounts were tried.
    expect(transport.seenMaterials).toHaveLength(2);
  });
});
