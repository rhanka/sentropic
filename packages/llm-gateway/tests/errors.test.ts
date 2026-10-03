/**
 * Lot-2: provider-shaped error mapping (spec §3b). Asserts the gateway maps
 * internal failure classes to the right provider-shaped status/body for BOTH
 * wires, attaches Retry-After where the spec requires it, and NEVER leaks pool
 * internals. Driven through the real router over fixtures.
 */

import { describe, expect, it } from 'vitest';

import { NativeMessagesUpstreamError, RoutePlanError, RouteQuoteError } from '@sentropic/llm-mesh';
import {
  GatewayError,
  mapGatewayError,
  NATIVE_BILLING_MASKED_MESSAGE,
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

  it('maps budget-unavailable to the sanitized pooled 503 on both wires, without Retry-After', () => {
    for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
      const budget = toProviderShapedError(wire, new GatewayError('budget-unavailable', 'pricing row missing'));
      expect(budget).toEqual(mapGatewayError(wire, 'pooled-account-unavailable'));
      expect(budget.headers).toBeUndefined();
      expect(JSON.stringify(budget.body)).not.toContain('pricing');
    }
  });

  it('maps a budget over-budget GatewayError to the frozen 429 with its bounded Retry-After', () => {
    for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
      const refusal = toProviderShapedError(wire, new GatewayError('over-budget', 'cap', 60));
      expect(refusal).toEqual(mapGatewayError(wire, 'upstream-rate-limited', 60));
      expect(refusal.headers).toEqual({ 'Retry-After': '60' });
    }
  });

  it('maps pooled-account-unavailable to 503', () => {
    const o = mapGatewayError('openai-chat-completions', 'pooled-account-unavailable');
    expect(o.status).toBe(503);
  });

  it('maps upstream-auth-failed to 401 authentication_error per wire', () => {
    const a = mapGatewayError('anthropic-messages', 'upstream-auth-failed');
    expect(a.status).toBe(401);
    expect((a.body as { error: { type: string } }).error.type).toBe('authentication_error');
    const o = mapGatewayError('openai-chat-completions', 'upstream-auth-failed');
    expect(o.status).toBe(401);
    expect((o.body as { error: { type: string } }).error.type).toBe('authentication_error');
  });

  it('maps upstream-rate-limited to 429 with Retry-After', () => {
    const a = mapGatewayError('anthropic-messages', 'upstream-rate-limited', 9);
    expect(a.status).toBe(429);
    expect((a.body as { error: { type: string } }).error.type).toBe('rate_limit_error');
    expect(a.headers?.['Retry-After']).toBe('9');
    const o = mapGatewayError('openai-chat-completions', 'upstream-rate-limited', 9);
    expect(o.status).toBe(429);
    expect(o.headers?.['Retry-After']).toBe('9');
  });

  it('maps bad-request to 400', () => {
    const a = mapGatewayError('anthropic-messages', 'bad-request');
    expect(a.status).toBe(400);
  });

  it('maps unknown-model to the Lot 1 404 with the model-only message', () => {
    const a = mapGatewayError('anthropic-messages', 'unknown-model', undefined, 'no-such-model');
    expect(a.status).toBe(404);
    expect(a.headers).toBeUndefined();
    expect(a.body).toEqual({
      type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model: "no-such-model"' },
    });
    const o = mapGatewayError('openai-chat-completions', 'unknown-model', undefined, 'no-such-model');
    expect(o.status).toBe(404);
    expect(o.headers).toBeUndefined();
    expect(o.body).toEqual({
      error: {
        message: 'Unknown model: "no-such-model"',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
  });

  it('falls back to a model-free 404 message without request context', () => {
    const a = mapGatewayError('anthropic-messages', 'unknown-model');
    expect(a.status).toBe(404);
    expect(a.body).toEqual({
      type: 'error',
      error: { type: 'not_found_error', message: 'Unknown model' },
    });
  });

  it('forwards the requested model through the GatewayError branch', () => {
    const mapped = toProviderShapedError(
      'anthropic-messages',
      new GatewayError('unknown-model', 'unknown model'),
      'no-such-model',
    );
    expect(mapped.status).toBe(404);
    expect((mapped.body as { error: { message: string } }).error.message).toBe(
      'Unknown model: "no-such-model"',
    );
    // The internal detail (even a leaking one) NEVER reaches the wire body.
    const leaked = toProviderShapedError(
      'openai-chat-completions',
      new GatewayError('unknown-model', 'internal pool detail acct-alpha'),
      'no-such-model',
    );
    expect(JSON.stringify(leaked.body)).not.toContain('acct-alpha');
    expect(JSON.stringify(leaked.body)).not.toContain('internal pool detail');
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

  it('maps real and structural plan/quote unknown-model to the Lot 1 404', () => {
    const failures: unknown[] = [
      new RoutePlanError('Unknown requested model', 'unknown-model'),
      new RouteQuoteError('Unknown requested model', 'unknown-model'),
      Object.assign(new Error('Unknown requested model'), { name: 'RoutePlanError', code: 'unknown-model' }),
      Object.assign(new Error('Unknown requested model'), { name: 'RouteQuoteError', code: 'unknown-model' }),
    ];
    for (const error of failures) {
      for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
        const mapped = toProviderShapedError(wire, error, 'no-such-model');
        expect(mapped.status).toBe(404);
        expect(mapped.headers).toBeUndefined();
        expect((mapped.body as { error: { message: string } }).error.message).toBe(
          'Unknown model: "no-such-model"',
        );
        expect(JSON.stringify(mapped.body)).not.toContain('Unknown requested model');
      }
    }
  });

  it('rejects code-only, message-only and wrong-name model errors (generic 503)', () => {
    const negatives: unknown[] = [
      Object.assign(new Error('x'), { code: 'unknown-model' }),
      new Error('unknown model: no-such-model'),
      Object.assign(new Error('x'), { name: 'SomethingElse', code: 'unknown-model' }),
      new RoutePlanError('Route quote does not match this plan', 'quote-mismatch'),
    ];
    for (const error of negatives) {
      const mapped = toProviderShapedError('anthropic-messages', error, 'no-such-model');
      expect(mapped.status).toBe(503);
      expect(JSON.stringify(mapped.body)).not.toContain('no-such-model');
    }
  });

  it('maps known-model no-route to the BR-REL-Q7 non-retryable 503', () => {
    const a = mapGatewayError('anthropic-messages', 'no-route', undefined, 'known-model');
    expect(a.status).toBe(503);
    expect(a.headers).toEqual({ 'x-should-retry': 'false' });
    expect(a.body).toEqual({
      type: 'error',
      error: { type: 'api_error', message: 'No route available for model: "known-model"' },
    });
    // A supplied retry delay never becomes Retry-After on this branch.
    const o = mapGatewayError('openai-chat-completions', 'no-route', 30, 'known-model');
    expect(o.status).toBe(503);
    expect(o.headers).toEqual({ 'x-should-retry': 'false' });
    expect(o.body).toEqual({
      error: {
        message: 'No route available for model: "known-model"',
        type: 'server_error', code: 'no_route',
      },
    });
    expect(JSON.stringify([a.body, o.body])).not.toContain('overloaded');
    expect(JSON.stringify([a.body, o.body])).not.toContain('rate_limit');
  });

  it('maps structural no-route to the Q7 503 with the requested model', () => {
    const failures: unknown[] = [
      new RoutePlanError('No eligible route', 'no-route'),
      Object.assign(new Error('No eligible route'), { name: 'RoutePlanError', code: 'no-route' }),
    ];
    for (const error of failures) {
      for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
        const mapped = toProviderShapedError(wire, error, 'known-model');
        expect(mapped.status).toBe(503);
        expect(mapped.headers).toEqual({ 'x-should-retry': 'false' });
        expect((mapped.body as { error: { message: string } }).error.message).toBe(
          'No route available for model: "known-model"',
        );
      }
    }
  });

  it('maps capability-invalid plan/quote and structural bad ceilings to 400', () => {
    const failures: unknown[] = [
      new RoutePlanError('Required capabilities are unavailable', 'capabilities-unmet'),
      new RouteQuoteError('Required capabilities are unavailable', 'capabilities-unmet'),
      Object.assign(new Error('ceiling'), { name: 'RouteQuoteError', code: 'invalid-ceiling' }),
    ];
    for (const error of failures) {
      for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
        const mapped = toProviderShapedError(wire, error, 'known-model');
        expect(mapped.status).toBe(400);
        expect(mapped.headers).toBeUndefined();
        expect(JSON.stringify(mapped.body)).toContain('invalid_request_error');
      }
    }
  });

  it('keeps the enrollment-action branch ahead of structural recognition', () => {
    const error = {
      name: 'RoutePlanError', code: 'no-route',
      diagnostic: { code: 'reauth-required', transportProviderId: 'cloud-code' },
    };
    const mapped = toProviderShapedError('anthropic-messages', error, 'known-model');
    expect(mapped).toMatchObject({
      status: 503,
      headers: { 'X-Sentropic-Route-Action': 'reauthenticate-cloud-code' },
      body: { error: { type: 'authentication_error', message: 'cloud-code reauthenticate required' } },
    });
  });

  it('maps an unclassified internal error to a generic 503 (no leak)', () => {
    const mapped = toProviderShapedError(
      'openai-chat-completions',
      new Error('Postgres connection to pool DB refused at 10.0.0.5'),
    );
    expect(mapped.status).toBe(503);
    expect(JSON.stringify(mapped.body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(mapped.body)).not.toContain('Postgres');
  });

  it('surfaces a redacted enrollment action without account material', () => {
    const mapped = toProviderShapedError('anthropic-messages', {
      diagnostic: {
        code: 'reenrollment-required',
        transportProviderId: 'codex',
      },
      accountRef: 'SECRET-ACCOUNT-ID',
    });
    expect(mapped).toMatchObject({
      status: 503,
      headers: { 'X-Sentropic-Route-Action': 're-enroll-codex' },
      body: { error: { type: 'authentication_error', message: 'codex re-enroll required' } },
    });
    expect(JSON.stringify(mapped)).not.toContain('SECRET-ACCOUNT-ID');
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

  it.each([
    ['/v1/messages', false],
    ['/v1/messages', true],
    ['/v1/chat/completions', false],
    ['/v1/chat/completions', true],
  ])('returns the Lot 1 404 for an unknown personal model (%s stream=%s)', async (path, stream) => {
    const transport = new FixtureTransport();
    const { app, metering } = buildHarness({ transport });
    const res = await app.request(path, {
      method: 'POST',
      headers: authHeaders('user-a'),
      body: JSON.stringify({ model: 'no-such-model', messages: [], stream }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('x-should-retry')).toBeNull();
    expect(res.headers.get('x-sentropic-request-id')).toBe('req_fixture_id');
    expect(res.headers.get('x-sentropic-served')).toBeNull();
    const body = await res.json();
    if (path === '/v1/messages') {
      expect(body).toEqual({
        type: 'error',
        error: { type: 'not_found_error', message: 'Unknown model: "no-such-model"' },
      });
    } else {
      expect(body).toEqual({
        error: {
          message: 'Unknown model: "no-such-model"',
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
    }
    expect(transport.seenMaterials).toHaveLength(0);
    expect(metering.settlements).toHaveLength(0);
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

  it('maps native-unavailable and structural refusals to safeguards 400 on both wires', () => {
    for (const error of [
      new GatewayError('native-unavailable', 'native route unavailable'),
      new RoutePlanError('native unavailable', 'native-unavailable'),
      new RouteQuoteError('native unavailable', 'native-unavailable'),
    ]) {
      const a = toProviderShapedError('anthropic-messages', error);
      expect(a.status).toBe(400);
      expect(a.body).toEqual({
        type: 'error', error: { type: 'invalid_request_error',
          message: 'safeguards is not supported by this gateway route; retry without safeguards.' },
      });
      const o = toProviderShapedError('openai-chat-completions', error);
      expect(o.status).toBe(400);
      expect(o.body).toEqual({
        error: { type: 'invalid_request_error', code: 'invalid_request',
          message: 'safeguards requires the Anthropic Messages endpoint.' },
      });
    }
  });

  it('maps typed native validation public detail without leaking internal error message', () => {
    const detail = { type: 'invalid_request_error', message: 'provider validation failure' };
    const upstreamError = new NativeMessagesUpstreamError({
      status: 400,
      type: 'invalid_request_error',
      validation: detail,
    });

    const a = toProviderShapedError('anthropic-messages', upstreamError);
    expect(a.status).toBe(400);
    expect(a.body).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'provider validation failure' } });

    const o = toProviderShapedError('openai-chat-completions', upstreamError);
    expect(o.status).toBe(400);
    expect(o.body).toEqual({ error: { type: 'invalid_request_error', message: 'provider validation failure', code: 'invalid_request' } });
  });

  it('restricts public validation relay to trusted native-validation 400 errors and retains fixed mappings', () => {
    const detail = { type: 'invalid_request_error', message: 'provider validation failure' };
    const forged = { name: 'NativeMessagesUpstreamError', status: 400, type: 'invalid_request_error', validation: detail };
    const genericBadRequest = new GatewayError('bad-request', 'secret log', undefined, undefined, detail);
    const absentType = new NativeMessagesUpstreamError({ status: 400, validation: detail });
    const longEmoji = new NativeMessagesUpstreamError({ status: 400, type: 'invalid_request_error', validation: { type: 'invalid_request_error', message: '😀'.repeat(2048) } });
    const controlError = new NativeMessagesUpstreamError({ status: 400, type: 'invalid_request_error', validation: { type: 'invalid_request_error', message: 'invalid\u0000 value' } });
    const malformedBilling = new NativeMessagesUpstreamError({ status: 400, validation: { type: 'invalid_request_error', message: 'Your credit balance is too low.' } });
    const upstream500 = new NativeMessagesUpstreamError({ status: 500, type: 'api_error', validation: detail });
    const authError = new GatewayError('caller-auth-failed', 'internal auth failure', undefined, undefined, detail);
    const upstream401 = new NativeMessagesUpstreamError({ status: 401, type: 'authentication_error', validation: detail });

    for (const wire of ['anthropic-messages', 'openai-chat-completions'] as const) {
      const arbMapped = toProviderShapedError(wire, forged);
      expect(arbMapped.status).toBe(503);
      expect(JSON.stringify(arbMapped)).not.toContain('provider validation failure');

      const gwMapped = toProviderShapedError(wire, genericBadRequest);
      expect(gwMapped.status).toBe(400);
      expect(JSON.stringify(gwMapped)).not.toContain('provider validation failure');
      expect(JSON.stringify(gwMapped)).toContain('invalid request');

      const absentMapped = toProviderShapedError(wire, absentType);
      expect(absentMapped.status).toBe(400);
      expect(JSON.stringify(absentMapped)).not.toContain('provider validation failure');
      expect(JSON.stringify(absentMapped)).toContain('invalid request');

      const emojiMapped = toProviderShapedError(wire, longEmoji);
      expect(emojiMapped.status).toBe(400);
      const emojiMsg = (emojiMapped.body as { error: { message: string } }).error.message;
      expect(new TextEncoder().encode(emojiMsg).length).toBeLessThanOrEqual(4096);

      const ctrlMapped = toProviderShapedError(wire, controlError);
      expect(ctrlMapped.status).toBe(400);
      const ctrlMsg = (ctrlMapped.body as { error: { message: string } }).error.message;
      expect(ctrlMsg).toBe('invalid value');
      expect(ctrlMsg).not.toContain('\u0000');

      const billMapped = toProviderShapedError(wire, malformedBilling);
      expect(billMapped.status).toBe(400);
      expect(JSON.stringify(billMapped)).toContain(NATIVE_BILLING_MASKED_MESSAGE);

      expect(toProviderShapedError(wire, upstream500).status).toBe(503);
      expect(toProviderShapedError(wire, authError).status).toBe(401);
      expect(toProviderShapedError(wire, upstream401).status).toBe(401);
    }
  });
});
