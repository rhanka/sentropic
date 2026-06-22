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

  it('relays OpenAI SSE chunks verbatim and appends data: [DONE]', async () => {
    const frames = openAiFrames();
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
    // Native chunks verbatim + the gateway-added [DONE] terminator.
    expect(text).toBe(`${frames.join('')}data: [DONE]\n\n`);

    const events = parseSse(text);
    expect(events[0]?.data).toContain('chat.completion.chunk');
    expect(events.at(-1)?.data).toBe('[DONE]');
    assertNoPoolSecrets(text);
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
});
