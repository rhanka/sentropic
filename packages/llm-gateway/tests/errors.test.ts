/**
 * Lot-2: provider-shaped error mapping (spec §3b). Asserts the gateway maps
 * internal failure classes to the right provider-shaped status/body for BOTH
 * wires, attaches Retry-After where the spec requires it, and NEVER leaks pool
 * internals. Driven through the real router over fixtures.
 */

import { describe, expect, it } from 'vitest';

import {
  GatewayError,
  mapGatewayError,
  toProviderShapedError,
} from '../src/index.js';
import { FixtureTransport } from './fixtures/transport.js';
import { apiKeyHeaders, authHeaders, buildHarness, twoAccountPool } from './fixtures/harness.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';
import { openAiRequest } from './fixtures/openai.js';

describe('provider-shaped error mapper (unit)', () => {
  it('maps caller-auth-failed to 401 per wire', () => {
    const a = mapGatewayError('anthropic-messages', 'caller-auth-failed');
    expect(a.status).toBe(401);
    expect((a.body as { type: string }).type).toBe('error');
    const o = mapGatewayError('openai-chat-completions', 'caller-auth-failed');
    expect(o.status).toBe(401);
    expect((o.body as { error: { type: string } }).error.type).toBe('invalid_request_error');
  });

  it('maps over-budget to 429 with Retry-After', () => {
    const a = mapGatewayError('anthropic-messages', 'over-budget', 30);
    expect(a.status).toBe(429);
    expect(a.headers?.['Retry-After']).toBe('30');
  });

  it('maps no-eligible-account to 429 (overloaded) with Retry-After', () => {
    const a = mapGatewayError('anthropic-messages', 'no-eligible-account', 5);
    expect(a.status).toBe(429);
    expect((a.body as { error: { type: string } }).error.type).toBe('overloaded_error');
    expect(a.headers?.['Retry-After']).toBe('5');
  });

  it('maps pooled-account-unavailable to 503', () => {
    const o = mapGatewayError('openai-chat-completions', 'pooled-account-unavailable');
    expect(o.status).toBe(503);
  });

  it('maps bad-request to 400', () => {
    const a = mapGatewayError('anthropic-messages', 'bad-request');
    expect(a.status).toBe(400);
  });

  it('toProviderShapedError maps a thrown GatewayError', () => {
    const mapped = toProviderShapedError(
      'anthropic-messages',
      new GatewayError('over-budget', 'internal detail: budget cap acct-alpha', 12),
    );
    expect(mapped.status).toBe(429);
    expect(mapped.headers?.['Retry-After']).toBe('12');
    // The internal detail (with the account id) MUST NOT reach the body.
    expect(JSON.stringify(mapped.body)).not.toContain('acct-alpha');
    expect(JSON.stringify(mapped.body)).not.toContain('budget cap');
  });

  it('maps an UNKNOWN internal error to a generic 503 (no leak)', () => {
    const mapped = toProviderShapedError(
      'openai-chat-completions',
      new Error('Postgres connection to pool DB refused at 10.0.0.5'),
    );
    expect(mapped.status).toBe(503);
    expect(JSON.stringify(mapped.body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(mapped.body)).not.toContain('Postgres');
  });
});

describe('error mapping through the router (integration)', () => {
  it('returns 401 when the SENTROPIC token is invalid', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer NOT-VALID', 'content-type': 'application/json' },
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(401);
    // No pooled account was even selected.
    expect(transport.seenMaterials).toHaveLength(0);
  });

  it('#10: authenticates a caller via x-api-key (Anthropic-SDK drop-in)', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport });
    // The Anthropic SDK sends the (sentropic) key as x-api-key, NO Authorization.
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: apiKeyHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    // Authenticated: the request ran end to end (account selected + dispatched).
    expect(res.status).toBe(200);
    expect(transport.seenMaterials).toHaveLength(1);
  });

  it('#10: an INVALID x-api-key still maps to 401 (no pool selected)', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'NOT-VALID', 'content-type': 'application/json' },
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(401);
    expect(transport.seenMaterials).toHaveLength(0);
  });

  it('returns 400 for an unsupported model', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ model: 'no-such-model', messages: [] }),
    });
    expect(res.status).toBe(400);
    expect(transport.seenMaterials).toHaveLength(0);
  });

  it('returns EXACTLY 400 for a malformed JSON body (§3b bad-request)', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { type: string; error: { type: string } };
    // Anthropic provider-shaped invalid-request envelope.
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('invalid_request_error');
    expect(transport.seenMaterials).toHaveLength(0);
  });

  it('returns 429 (overloaded) when no eligible pool account exists', async () => {
    const transport = new FixtureTransport();
    // Empty pool -> coordinator.acquire throws AccountTransportAcquireError.
    const { app } = buildHarness({ transport, accounts: [] });
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(anthropicRequest(false)),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('overloaded_error');
    expect(transport.seenMaterials).toHaveLength(0);
  });

  it('never leaks pool internals in an over-capacity error body', async () => {
    const transport = new FixtureTransport();
    const { app } = buildHarness({ transport, accounts: [] });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify(openAiRequest(false)),
    });
    const text = await res.text();
    for (const secret of twoAccountPool().map((a) => a.accountId)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('no_account');
    expect(text).not.toContain('lease');
    expect(text).not.toContain('reservation');
  });
});
