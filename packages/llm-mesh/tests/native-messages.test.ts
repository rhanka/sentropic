import { describe, expect, it, vi } from 'vitest';
import {
  composeAnthropicBeta, isNativeMessagesTarget, isPreparedNativeMessages,
  NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS, NativeMessagesUpstreamError,
  validateNativeModelAllowlist,
  type NativeMessagesRequest, type NativeUsageSnapshot, type PreparedNativeMessages,
  type RouteAttemptUsage,
} from '../src/index.js';
import { EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS } from '../src/routing-targets.js';

const qualifiedIds = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1'];
const prepared = (): PreparedNativeMessages => ({
  contractVersion: 1, protocol: 'anthropic-messages', modelId: qualifiedIds[0]!,
  apiVersions: ['2023-06-01'], requiredBetas: [],
  execute: vi.fn(async () => ({ kind: 'json' as const, status: 200 as const,
    body: {}, headers: {} })),
});

describe('native Messages contracts', () => {
  it('should validate structural capability without executing or authorizing features', () => {
    const capability = prepared();
    Object.defineProperty(capability, 'body', { get: () => { throw new Error('body inspected'); } });
    expect(isPreparedNativeMessages(capability)).toBe(true);
    expect(isPreparedNativeMessages({ ...prepared(), modelId: 'opaque-unqualified-model',
      requiredBetas: ['unknown-beta'] })).toBe(true);
    expect(capability.execute).not.toHaveBeenCalled();
  });

  it.each([
    { contractVersion: 2 }, { protocol: 'openai' }, { modelId: '' }, { modelId: '  ' },
    { modelId: 1 }, { apiVersions: [] }, { apiVersions: [''] }, { apiVersions: ['  '] },
    { apiVersions: ['2023-06-01', 1] }, { apiVersions: new Array(1) },
    { requiredBetas: undefined }, { requiredBetas: [1] }, { requiredBetas: new Array(1) },
    { execute: null }, { finalize: null }, { finalize: 'callback' },
  ])('should reject malformed capability fields %j', (patch) => {
    expect(isPreparedNativeMessages({ ...prepared(), ...patch })).toBe(false);
  });

  it.each([null, undefined, [], 1, 'native', {}])('should reject non-capabilities %j', (value) => {
    expect(isPreparedNativeMessages(value)).toBe(false);
  });

  it('should accept optional trusted finalize without invoking it during validation', () => {
    const finalize = vi.fn();
    expect(isPreparedNativeMessages({ ...prepared(), finalize })).toBe(true);
    expect(isPreparedNativeMessages({ ...prepared(), finalize: async () => {} })).toBe(true);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('should keep the default list empty and isolate a validated code-only override', () => {
    const source = [...qualifiedIds];
    const allowed = validateNativeModelAllowlist(source);
    source[0] = 'gpt-6-astra';
    expect(allowed).toEqual(qualifiedIds);
    expect(Object.isFrozen(allowed)).toBe(true);
    expect(NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS).toEqual([]);
    expect(isNativeMessagesTarget({ providerId: 'anthropic', modelId: qualifiedIds[0]! })).toBe(false);
  });

  it.each(['gpt-6-astra', 'unknown', 'claude-sonnet-5-xhigh', ' claude-opus-5',
    ...Object.keys(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS)])(
    'should reject non-Anthropic or nonexact allowlist entry %s', (modelId) => {
      expect(() => validateNativeModelAllowlist([modelId])).toThrow(/exact non-exclusive Anthropic/);
    });

  it.each(qualifiedIds)('should require exact provider and allowed model identity for %s', (modelId) => {
    const allowed = validateNativeModelAllowlist(qualifiedIds);
    expect(isNativeMessagesTarget({ providerId: 'anthropic', modelId }, allowed)).toBe(true);
    expect(isNativeMessagesTarget({ providerId: 'openai', modelId }, allowed)).toBe(false);
    expect(isNativeMessagesTarget({ providerId: 'anthropic', modelId: `${modelId}-xhigh` }, allowed))
      .toBe(false);
  });

  it.each([undefined, '', '  ', 'unknown, beta ,unknown',
    'dangerous-tool-use-2026-09-03, auto-mode-classifier-2026-07-16', 'x'.repeat(8192)])(
    'should preserve parser-retained caller beta with empty required betas %#', (raw) => {
      expect(composeAnthropicBeta(raw, [])).toBe(raw);
    });

  it('should append future transport betas without rewriting caller tokens', () => {
    expect(composeAnthropicBeta('z, a ,z', ['z', 'future'])).toBe('z, a ,z,z,future');
    expect(composeAnthropicBeta(undefined, ['future'])).toBe('future');
  });

  it('should carry resolved version and opaque feature values in the request contract', () => {
    const headers = { 'anthropic-unknown-feature': 'opaque', 'anthropic-beta': ' z, a ,z ' };
    const request: NativeMessagesRequest = { body: { safeguards: null, container: {}, mcp_servers: [] },
      stream: false, headers: { anthropicVersion: prepared().apiVersions[0]!, forwarded: headers },
      signal: new AbortController().signal, requestId: 'server-request' };
    expect(request.headers.anthropicVersion).toBe('2023-06-01');
    expect(composeAnthropicBeta(request.headers.forwarded['anthropic-beta'], [])).toBe(headers['anthropic-beta']);
    expect(request.headers.forwarded['anthropic-unknown-feature']).toBe('opaque');
  });

  it('should carry physical usage independently of raw categories and pricing allocation', async () => {
    const snapshot: NativeUsageSnapshot = Object.freeze({ inputTokens: 10400, outputTokens: 500,
      totalTokens: 10900, rawUsage: Object.freeze({ input_tokens: 100, cache_read_input_tokens: 10000,
        cache_creation_input_tokens: 300, cache_creation: Object.freeze({ ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 200 }), output_tokens: 500 }),
      nativeInputPriceUnits40: 68000, nativePricingPolicy: 'anthropic-cache-2026-10-02',
      nativeSelectedModelId: qualifiedIds[0]!, nativeServedModelId: qualifiedIds[0]!,
      nativeInputUsageValidated: true, nativeInputUsageSource: 'message_delta',
      nativeCacheWriteSplitReason: 'cache_write_split_inferred', estimated: false,
      finalOutputObserved: true, termination: 'completed', fallbackPresent: false, iterationsPresent: false });
    const finalize = vi.fn<(value: NativeUsageSnapshot) => void>();
    const capability: PreparedNativeMessages = { ...prepared(), finalize };
    await capability.finalize?.(snapshot);
    expect(finalize.mock.calls[0]?.[0]).toBe(snapshot);
    const attempt: RouteAttemptUsage = { ...snapshot, inputTokens: snapshot.inputTokens!,
      outputTokens: snapshot.outputTokens! };
    expect(attempt.inputTokens).toBe(10400);
    expect(attempt.nativeInputPriceUnits40).toBe(68000);
    expect(snapshot.rawUsage?.cache_creation?.ephemeral_1h_input_tokens).toBe(200);
    expect(attempt.estimated).toBe(false);
  });

  it('should keep transport errors fixed and preserve operational usage without provider prose', () => {
    const usage: RouteAttemptUsage = { inputTokens: 0, outputTokens: 0, estimated: false };
    const error = new NativeMessagesUpstreamError({ status: 503, code: 'account_unavailable', usage });
    expect(error.message).toBe('Native Anthropic Messages request failed');
    expect(error.usage).toBe(usage);
    expect(error.code).toBe('account_unavailable');
  });
});
