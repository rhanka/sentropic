import { describe, expect, it } from 'vitest';
import { buildNativeRequestHeaders, nativeHeaderExclusions } from '../src/native-headers.js';
import { classifyNativeFeatures } from '../src/native-features.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';

const dropped = [
  'connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding',
  'upgrade', 'proxy-authenticate', 'proxy-authorization',
  'authorization', 'x-api-key', 'api-key', 'anthropic-api-key', 'anthropic-admin-api-key',
  'anthropic-oauth-token', 'anthropic-key', 'cookie', 'cookie2', 'set-cookie', 'set-cookie2',
  'x-sentropic-caller', 'x-sentropic-settlement-mode', 'x-sentropic-request-id', 'x-sentropic-future',
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via',
  'true-client-ip', 'cf-connecting-ip', 'cf-ray', 'origin', 'referer', 'sec-fetch-site',
  'traceparent', 'tracestate', 'baggage', 'expect', 'accept-encoding', 'content-encoding',
  'content-length', 'host', 'content-type', 'accept', 'user-agent', 'unknown-caller-header',
];

describe('native request header policy', () => {
  it.each(dropped.flatMap((name) => [name, name.toUpperCase()]))(
    'should drop excluded and non-forwardable caller header %s', (name) => {
      expect(buildNativeRequestHeaders({ [name]: 'caller-value' })).toEqual({});
    });
  it('should preserve known and arbitrary Anthropic features and the closed SDK caller set', () => {
    const headers = Object.freeze({
      'ANTHROPIC-BETA': 'unknown-2026-01-01, other , third', 'Anthropic-Version': '2023-06-01',
      'anthropic-workspace-id': 'workspace', 'anthropic-organization-id': 'organization',
      'anthropic-profile': 'profile', 'anthropic-billing-feature': 'provider-defined',
      'Anthropic-Future-Extension': 'opaque:value', 'X-App': 'client',
      'X-Stainless-Lang': 'typescript', 'x-stainless-future': 'opaque SDK metadata',
    });
    const forwarded = buildNativeRequestHeaders(headers);
    expect(forwarded).toEqual({
      'anthropic-beta': 'unknown-2026-01-01, other , third', 'anthropic-version': '2023-06-01',
      'anthropic-workspace-id': 'workspace', 'anthropic-organization-id': 'organization',
      'anthropic-profile': 'profile', 'anthropic-billing-feature': 'provider-defined',
      'anthropic-future-extension': 'opaque:value', 'x-app': 'client',
      'x-stainless-lang': 'typescript', 'x-stainless-future': 'opaque SDK metadata',
    });
    expect(forwarded).not.toBe(headers); expect(headers['X-App']).toBe('client');
  });
  it.each(['', '   ', 'beta-one , unknown-beta, beta-one'])('should preserve beta values without custom grammar: %j', (beta) => {
    expect(buildNativeRequestHeaders({ 'anthropic-beta': beta })).toEqual({ 'anthropic-beta': beta });
  });
  it('should apply every Connection nomination before the allow rule', () => {
    expect(buildNativeRequestHeaders({
      Connection: ' keep-alive, ANTHROPIC-BETA, anthropic-version, X-APP, x-stainless-lang, Anthropic-Future ',
      'anthropic-beta': 'opaque', 'anthropic-version': '2023-06-01', 'x-app': 'client',
      'x-stainless-lang': 'typescript', 'anthropic-future': 'opaque', 'anthropic-remaining': 'kept',
    })).toEqual({ 'anthropic-remaining': 'kept' });
  });
  it('should retain response credential exclusions for reuse in the opposite direction', () => {
    const excluded = nativeHeaderExclusions({ Connection: 'Anthropic-Future' });
    for (const name of ['set-cookie', 'set-cookie2', 'authorization', 'anthropic-api-key', 'anthropic-future']) {
      expect(excluded.has(name)).toBe(true);
    }
    expect(excluded.has('anthropic-organization-id')).toBe(false);
  });
  it('should carry only sanitized caller headers in native selection without refusing unrelated nominations', () => {
    const body = { model: 'claude-sonnet-5', messages: [], max_tokens: 64, safeguards: null };
    const selection = classifyNativeFeatures('anthropic-messages', {
      'anthropic-beta': 'unknown, native', 'anthropic-api-key': 'caller-secret', authorization: 'Bearer session',
      'anthropic-feature': 'strip-me', connection: 'anthropic-feature',
      'x-sentropic-caller': 'spoof', 'x-forwarded-for': '198.51.100.1',
      'user-agent': 'caller-agent', 'x-stainless-lang': 'typescript', 'anthropic-future': 'keep-me',
    }, body, normalizeGatewayIngress('anthropic-messages', body), {});
    expect(selection).toMatchObject({ kind: 'required', forwarded: {
      'anthropic-beta': 'unknown, native', 'x-stainless-lang': 'typescript', 'anthropic-future': 'keep-me',
    } });
    if (selection.kind === 'none') throw new Error('expected native selection');
    expect(Object.keys(selection.forwarded)).toHaveLength(3);
    expect(JSON.stringify(selection)).not.toMatch(/caller-secret|Bearer session|spoof|198\.51\.100\.1|caller-agent|strip-me/);
  });
});
