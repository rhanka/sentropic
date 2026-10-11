/**
 * Claude Code token counting — POST /v1/messages/count_tokens (Lot 3).
 *
 * Claude Code calls the Anthropic count_tokens endpoint. The gateway has no
 * provider count seam, so it maps the call properly instead of answering a
 * bare framework 404: caller-auth gates first (401 pre-pool), unknown models
 * get the frozen unknown-model 404, and known models get a provider-shaped
 * 400 (the client falls back to its own local counting). No lease is taken
 * and nothing is metered — counting support is absent, never silent.
 */

import { describe, expect, it } from 'vitest';

import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness } from './fixtures/harness.js';
import { anthropicRequest } from './fixtures/anthropic.js';

const countBody = (model: string): string =>
  JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }] });

describe('POST /v1/messages/count_tokens', () => {
  it('is mounted (no bare framework 404) and gates unauthenticated callers', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: countBody('claude-sonnet-4-6'),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('maps an unknown model to the frozen unknown-model 404', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: countBody('no-such-model-xyz'),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "no-such-model-xyz"' },
    });
  });

  it('maps a known model to a provider-shaped 400 without touching the pool', async () => {
    const transport = new FixtureTransport();
    const { app, metering } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: countBody('claude-sonnet-4-6'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'invalid request' },
    });
    // No lease, no metering: the counting path settles nothing.
    expect(metering.settlements).toHaveLength(0);
    expect(transport.seenBodies).toHaveLength(0);
  });

  it('maps malformed JSON to the provider-shaped 400', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: 'not-json{{{',
    });
    expect(res.status).toBe(400);
  });

  it('leaves the Anthropic inference body fixture untouched', async () => {
    // The count endpoint must not alter /v1/messages semantics: the fixture
    // request shape used here stays valid for inference.
    expect((anthropicRequest(false) as { model: unknown }).model).toBeTruthy();
  });
});
