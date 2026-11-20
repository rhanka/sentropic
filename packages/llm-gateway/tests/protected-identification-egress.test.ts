import { describe, expect, it } from 'vitest';
import {
  captureCanonicalProtectedProjection,
  captureProtectedIdentification,
  verifyProtectedIdentificationAtEgress,
} from '../src/guards/protected-identification.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { GatewayError } from '../src/router/errors.js';

const MODEL = 'claude-sonnet-5';

describe('L1.5 Protected Identification Invariant — unit capture, 3-wire P fields, positions & r8-F2 headers', () => {
  it('allows compliant model/effort rewrite, non-protected message/cache_control updates, and drops user-agent', () => {
    const rawHeaders = {
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-app': 'claude-code',
      'x-stainless-lang': 'js',
      'x-claude-code-session': 'sess-1',
      'user-agent': 'claude-cli/1.0',
      authorization: 'Bearer secret',
      'x-sentropic-request-id': 'req-1',
    };
    const rawBody = {
      model: MODEL,
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: 'Attribution', cache_control: { type: 'ephemeral' } }],
      metadata: { user_id: 'u-1' },
      tools: [{ name: 'bash', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } }],
      additional_tools: [{ name: 'extra' }],
      safeguards: { mode: 'strict' },
      messages: [
        { role: 'system', content: 'sys-0' },
        { role: 'user', content: [{ type: 'text', text: 'turn-1', cache_control: { type: 'ephemeral' } }] },
        { role: 'developer', content: 'dev-2' },
        { role: 'user', content: [{ type: 'text', text: 'turn-3', cache_control: { type: 'ephemeral' } }] },
      ],
    };
    const ingress = captureProtectedIdentification('anthropic-messages', rawBody, rawHeaders);
    expect(ingress.headers.providerIdentityHeaders).toEqual({
      'anthropic-beta': 'prompt-caching-2024-07-31', 'x-app': 'claude-code', 'x-stainless-lang': 'js',
    });
    expect(ingress.headers.hopIdentityHeaders).toEqual({
      ...ingress.headers.providerIdentityHeaders, 'x-claude-code-session': 'sess-1',
    });
    expect(ingress.headers.connectionNominatedIdentityHeader).toBe(false);

    const compliantBody = {
      ...rawBody, model: 'claude-opus-5', reasoning: { effort: 'high' },
      messages: [
        rawBody.messages[0],
        { role: 'user', content: [{ type: 'text', text: 'filtered-turn-1' }] },
        rawBody.messages[2],
        { role: 'user', content: [{ type: 'text', text: 'compacted-turn-3', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ],
    };
    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, egressKind: 'provider-canonical', body: compliantBody, headers: rawHeaders,
    })).not.toThrow();
    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, egressKind: 'provider-native', body: compliantBody, headers: rawHeaders,
      nativeForwardedHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31', 'x-app': 'claude-code', 'x-stainless-lang': 'js' },
    })).not.toThrow();

    // Sealed prefix cache_control, additional_tools, safeguards, and header drops must fail closed
    for (const mutated of [
      { ...rawBody, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { ...rawBody, system: [{ type: 'text', text: 'Attribution' }] },
      { ...rawBody, tools: [{ name: 'bash', input_schema: { type: 'object' } }] },
      { ...rawBody, additional_tools: [] },
      { ...rawBody, safeguards: {} },
    ]) {
      expect(() => verifyProtectedIdentificationAtEgress({
        ingress, egressKind: 'provider-canonical', body: mutated, headers: rawHeaders,
      })).toThrow(GatewayError);
    }
    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, egressKind: 'provider-canonical', body: rawBody,
      headers: { ...rawHeaders, 'x-claude-code-session': 'tampered' },
    })).toThrow(GatewayError);
  });

  it('refuses absolute position violations (0..i_last), mid-array developer shifts, synthetic injection, and Responses typed/typeless items', () => {
    const chatBody = {
      model: 'gpt-5.6-terra', metadata: { a: '1' }, user: 'u1', safety_identifier: 's1', prompt_cache_key: 'pk1',
      tools: [{ type: 'function', function: { name: 't' } }],
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'u1' },
        { role: 'developer', content: 'dev' },
        { role: 'user', content: 'u2' },
      ],
    };
    const chatIngress = captureProtectedIdentification('openai-chat-completions', chatBody, {});
    for (const mutated of [
      { ...chatBody, messages: [{ role: 'user', content: 'pre' }, ...chatBody.messages] },
      { ...chatBody, messages: [chatBody.messages[0], { role: 'assistant', content: 'u1' }, chatBody.messages[2]] },
      { ...chatBody, messages: [...chatBody.messages, { role: 'developer', content: 'extra' }] },
      { ...chatBody, user: 'other' },
      { ...chatBody, prompt_cache_key: 'pk2' },
    ]) {
      expect(() => verifyProtectedIdentificationAtEgress({
        ingress: chatIngress, egressKind: 'provider-canonical', headers: {}, body: mutated,
      })).toThrow(GatewayError);
    }

    const respBody = {
      model: 'gpt-5.6-terra', instructions: 'Top instructions',
      metadata: { trace: '1' }, client_metadata: { cli: 'codex' }, safety_identifier: 'safe-1', prompt_cache_key: 'pk-1',
      input: [
        { type: 'message', role: 'system', content: 'sys-typed' },
        { role: 'developer', content: 'dev-typeless' },
        { role: 'user', content: 'hello' },
      ],
    };
    const respIngress = captureProtectedIdentification('openai-responses', respBody, {});
    for (const mutated of [
      { ...respBody, instructions: 'Mutated instructions' },
      { ...respBody, client_metadata: { cli: 'other' } },
      { ...respBody, input: [respBody.input[0], { role: 'developer', content: 'dev-mutated' }, respBody.input[2]] },
      { ...respBody, input: [{ role: 'user', content: 'pre' }, ...respBody.input] },
    ]) {
      expect(() => verifyProtectedIdentificationAtEgress({
        ingress: respIngress, egressKind: 'provider-canonical', headers: {}, body: mutated,
      })).toThrow(GatewayError);
    }
  });

  it('uniformly rejects Connection-nominated protected headers (r8-F2) across native, canonical, legacy, and relay-hop', () => {
    const headers = {
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-claude-code-session': 's1',
      connection: 'keep-alive, x-claude-code-session',
    };
    const body = { model: MODEL, messages: [{ role: 'user', content: 'hi' }] };
    const ingress = captureProtectedIdentification('anthropic-messages', body, headers);
    expect(ingress.headers.connectionNominatedIdentityHeader).toBe(true);
    for (const egressKind of ['provider-native', 'provider-canonical', 'legacy-flow', 'relay-hop'] as const) {
      expect(() => verifyProtectedIdentificationAtEgress({
        ingress, egressKind, body, headers,
        ...(egressKind === 'provider-native' ? { nativeForwardedHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' } } : {}),
      })).toThrow(GatewayError);
    }
  });

  it('protects openai-responses input[*] additional_tools items against mutation, removal, reorder, and injection', () => {
    const respBody = {
      model: 'gpt-6.1-sol',
      input: [
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [{ type: 'function', name: 'exec_cmd', description: 'Run command', parameters: { type: 'object' } }],
        },
        { type: 'message', role: 'user', content: 'hi' },
      ],
    };
    const ingress = captureProtectedIdentification('openai-responses', respBody, {});
    const canonical = normalizeGatewayIngress('openai-responses', respBody);
    const canonicalIngress = captureCanonicalProtectedProjection('openai-responses', canonical.request);

    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, canonicalIngress, egressKind: 'provider-canonical', body: respBody, headers: {},
      canonicalRequest: canonical.request,
    })).not.toThrow();
    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, canonicalIngress, egressKind: 'provider-canonical', body: respBody, headers: {},
      canonicalRequest: { ...canonical.request, tools: [] },
    })).toThrow(GatewayError);

    const mutations = [
      { ...respBody, input: [{ ...respBody.input[0], tools: [{ type: 'function', name: 'exec_cmd', description: 'Mutated', parameters: { type: 'object' } }] }, respBody.input[1]] },
      { ...respBody, input: [respBody.input[1]] },
      { ...respBody, input: [{ type: 'message', role: 'user', content: 'pre' }, ...respBody.input] },
      { ...respBody, input: [...respBody.input, { type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'injected', parameters: { type: 'object' } }] }] },
    ];
    for (const mutated of mutations) {
      for (const egressKind of ['relay-hop', 'legacy-flow', 'provider-canonical'] as const) {
        expect(() => verifyProtectedIdentificationAtEgress({
          ingress, egressKind, body: mutated, headers: {},
        })).toThrow(GatewayError);
      }
    }
  });

  it('keeps large bodies (<= 32 MiB) bounded in memory using streaming 32-byte JCS SHA-256 digests', () => {
    const size = 20 * 1024 * 1024;
    const largeSystem = `${'a'.repeat(65_535)}😀${'b'.repeat(size - 65_537)}`;
    // Flatten the test fixture string before measuring capture/verify memory delta.
    expect(largeSystem.charCodeAt(0)).toBe(97);
    const largeBody = { model: MODEL, system: largeSystem, messages: [{ role: 'user', content: 'hi' }] };
    const canonical = normalizeGatewayIngress('anthropic-messages', largeBody);
    const beforeHeap = process.memoryUsage().heapUsed;
    const ingress = captureProtectedIdentification('anthropic-messages', largeBody, {});
    expect(ingress.bodyBytes.byteLength).toBe(32);
    const canonicalIngress = captureCanonicalProtectedProjection('anthropic-messages', canonical.request, {
      ref: largeBody, bytes: ingress.bodyBytes,
    });
    expect(canonicalIngress.bytes.byteLength).toBe(32);
    verifyProtectedIdentificationAtEgress({
      ingress, canonicalIngress, egressKind: 'provider-canonical',
      body: largeBody, headers: {}, canonicalRequest: canonical.request,
    });
    const afterHeap = process.memoryUsage().heapUsed;
    expect(afterHeap - beforeHeap).toBeLessThan(16 * 1024 * 1024);

    const mutatedBody = { ...largeBody, system: `${largeSystem.slice(0, -1)}c` };
    expect(() => verifyProtectedIdentificationAtEgress({
      ingress, egressKind: 'provider-canonical', body: mutatedBody, headers: {},
    })).toThrow(GatewayError);
  });
});
