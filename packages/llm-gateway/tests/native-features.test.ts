/** Native Messages feature classification (spec §17, lot N10): selection only. */
import { describe, expect, it } from 'vitest';
import * as features from '../src/native-features.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { toProviderShapedError } from '../src/router/errors.js';

const wire = 'anthropic-messages' as const;
const base = { model: 'claude-sonnet-5', messages: [], max_tokens: 64 };
const select = (body = base as Record<string, unknown>, headers: Record<string, string> = {},
  options: Parameters<typeof features.classifyNativeFeatures>[4] = {}, ingress = wire as
  'anthropic-messages' | 'openai-chat-completions') =>
  features.classifyNativeFeatures(ingress, headers, body, normalizeGatewayIngress(ingress, body), options);

describe('native feature classification', () => {
  it.each<Record<string, string>>([
    {}, { 'Anthropic-Version': '2023-06-01' }, { 'anthropic-future-feature': 'opaque' },
  ])('keeps version-only and unrelated Anthropic headers canonical: %j', (headers) => {
    expect(select(base, headers)).toEqual({ kind: 'none' });
  });

  it.each(['', '   ', 'unknown-beta, beta-two , future-2026-01-01'])(
    'selects a present beta without rewriting its value: %j', (beta) => {
      expect(select(base, { 'ANTHROPIC-BETA': beta, 'Anthropic-Version': 'future-version' }))
        .toEqual({ kind: 'optional', anthropicBeta: beta, anthropicVersion: 'future-version', maxOutputTokens: 64 });
    });

  it.each([null, {}, [], false, 'provider-defined'])('requires native for own safeguards: %j', (safeguards) => {
    expect(select({ ...base, safeguards, container: {}, mcp_servers: [], unknown_extension: true }))
      .toMatchObject({ kind: 'required', maxOutputTokens: 64 });
  });

  it('ignores inherited safeguards and nested content safeguards', () => {
    expect(select(Object.assign(Object.create({ safeguards: {} }), base))).toEqual({ kind: 'none' });
    expect(select({ ...base, messages: [{ role: 'user', content: [{ safeguards: {} }] }] }))
      .toEqual({ kind: 'none' });
  });

  it('imposes no beta token, feature name or custom header-size limits', () => {
    const beta = Array.from({ length: 200 }, (_, i) => `unknown-${i}-2026-01-01`).join(', ');
    expect(select(base, { 'anthropic-beta': beta, 'anthropic-future': 'x'.repeat(8192) }))
      .toMatchObject({ kind: 'optional', anthropicBeta: beta });
  });

  it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'keeps optional traffic canonical and refuses unbounded required traffic: %j', (max_tokens) => {
      const body = { ...base, max_tokens };
      expect(select(body, { 'anthropic-beta': '' })).toEqual({ kind: 'none' });
      expect(() => select({ ...body, safeguards: {} })).toThrow(expect.objectContaining({ kind: 'native-max-tokens-required' }));
    });

  it('keeps OpenAI headers canonical and refuses OpenAI safeguards with its own envelope', () => {
    expect(select(base, { 'anthropic-beta': '' }, {}, 'openai-chat-completions')).toEqual({ kind: 'none' });
    let error: unknown;
    try { select({ ...base, safeguards: {} }, {}, {}, 'openai-chat-completions'); } catch (caught) { error = caught; }
    expect(toProviderShapedError('openai-chat-completions', error)).toEqual({ status: 400,
      body: { error: { type: 'invalid_request_error', code: 'invalid_request',
        message: 'safeguards requires the Anthropic Messages endpoint.' } } });
  });

  it.each(['anthropic-beta', 'ANTHROPIC-VERSION'])('refuses required and falls back optional on nominated markers: %s', (name) => {
    const headers = { Connection: `keep-alive, ${name}`, 'anthropic-beta': 'opaque', 'anthropic-version': '2023-06-01' };
    expect(select(base, headers)).toEqual({ kind: 'none' });
    expect(() => select({ ...base, safeguards: {} }, headers)).toThrow(expect.objectContaining({ kind: 'native-required' }));
  });
});
