import { describe, expect, it } from 'vitest';
import { nativeHarness, sendNative } from './fixtures/native-flow.js';

describe('native router response identity', () => {
  it.each([
    { model: 'claude-served-future', expected: 'claude-served-future' },
    { model: undefined, expected: undefined },
    { model: 'invalid\r\nmodel', expected: undefined },
    { model: 'claude-served-future', usage: { iterations: [{}] }, expected: undefined },
    { model: 'claude-served-future', usage: { iterations: [] }, expected: 'claude-served-future' },
  ])('reports only a safe single served model: %j', async ({ model, usage, expected }) => {
    const body = { model, usage: { input_tokens: 2, output_tokens: 3, ...usage }, safeguard_results: { future: true } };
    const h = nativeHarness({ execute: async () => ({ kind: 'json', status: 200,
      headers: { 'anthropic-organization-id': 'org-shared', 'anthropic-future-feature': 'opaque', 'request-id': 'upstream' }, body }) });
    const response = await sendNative(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get('anthropic-organization-id')).toBe('org-shared');
    expect(response.headers.get('anthropic-future-feature')).toBe('opaque');
    expect(response.headers.get('request-id')).toBe('upstream');
    expect(response.headers.get('x-sentropic-relay')).toBe('native');
    expect(response.headers.get('x-sentropic-request-id')).toBe('req-native');
    expect(response.headers.get('x-sentropic-served')).toBe(expected
      ? `provider=anthropic; model=${expected}; transport=anthropic` : null);
  });
});
