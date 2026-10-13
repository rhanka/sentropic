/**
 * Responses router contract, D16-A slice (spec §16.2): one routed ingress on
 * two paths (`POST /responses`, `POST /v1/responses`) with the same caller
 * admission as Messages/Chat. Extended by later D16 slices (normalizer,
 * execution features, 413 body cap, capability rejection) in this file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RoutePlanner } from '@sentropic/llm-mesh';

import { createGatewayRouter, stubGatewayConfig } from '../src/index.js';
import { WIRE_BY_PATH } from '../src/wire.js';

const scaffoldApp = () => createGatewayRouter({ config: stubGatewayConfig });

const routedApp = () => createGatewayRouter({
  config: stubGatewayConfig,
  routePlanner: {} as unknown as RoutePlanner,
  routeMetering: { settleRoute: vi.fn() },
});

describe('Responses wire mapping', () => {
  it('maps both Responses paths to the openai-responses wire', () => {
    expect(WIRE_BY_PATH['/responses']).toBe('openai-responses');
    expect(WIRE_BY_PATH['/v1/responses']).toBe('openai-responses');
  });
});

describe('Responses routes (D16-A admission parity)', () => {
  it.each(['/responses', '/v1/responses'])('mounts %s with an OpenAI-shaped scaffold 501', async (path) => {
    const res = await scaffoldApp().request(path, { method: 'POST' });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { message: string; type: string; code?: string } };
    expect(body.error.type).toBe('server_error');
    expect(body.error.code).toBe('not_implemented');
    expect(res.headers.get('X-Sentropic-Request-Id')).toBeTruthy();
  });

  it.each(['/responses', '/v1/responses'])('rejects malformed JSON with 400 before authentication: %s', async (path) => {
    const res = await routedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string; code?: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('invalid_request');
  });

  it.each(['/responses', '/v1/responses'])('rejects a missing model with 400 before authentication: %s', async (path) => {
    const res = await routedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hello' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string; code?: string } };
    expect(body.error.type).toBe('invalid_request_error');
  });

  it.each(['/responses', '/v1/responses'])('applies the same caller-token admission as Chat: %s', async (path) => {
    const res = await routedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', input: 'hello' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string; code?: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toBe('authentication failed');
  });
});

describe('Responses body cap (D16-F 413)', () => {
  const cappedApp = () => createGatewayRouter({
    config: stubGatewayConfig,
    routePlanner: {} as unknown as RoutePlanner,
    routeMetering: { settleRoute: vi.fn() },
    responsesLimits: { maxBodyBytes: 64 },
  });

  it.each(['/responses', '/v1/responses'])('refuses an over-cap JSON body with 413: %s', async (path) => {
    const res = await cappedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', input: 'x'.repeat(128) }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { type: string; code?: string } };
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('request_too_large');
    expect(res.headers.get('X-Sentropic-Request-Id')).toBeTruthy();
  });

  it.each(['/responses', '/v1/responses'])('caps a headerless stream body the same way: %s', async (path) => {
    const chunk = JSON.stringify({ model: 'gpt-6.1-sol', input: 'y'.repeat(128) });
    const res = await cappedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }),
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it.each(['/responses', '/v1/responses'])('passes an under-cap body to admission: %s', async (path) => {
    const res = await cappedApp().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-6.1-sol', input: 'hi' }),
    });
    expect(res.status).toBe(401);
  });
});
