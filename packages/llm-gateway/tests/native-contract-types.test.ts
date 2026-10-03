import { describe, expect, it, vi } from 'vitest';
import { NativeAttemptRefusal, prepareNativeMessages } from '../src/route-native.js';
import { refuseNativeAttempt } from '../src/route-flow-core.js';
import { toProviderShapedError } from '../src/index.js';
import type { NativeFeatureSelection } from '../src/native-features.js';
import type { PreparedNativeMessages, PreparedRouteAttempt } from '@sentropic/llm-mesh';

describe('native contract types and refusal lifecycle', () => {
  const capability: PreparedNativeMessages = {
    contractVersion: 1,
    protocol: 'anthropic-messages',
    modelId: 'claude-sonnet-5',
    apiVersions: ['2023-06-01'],
    requiredBetas: [],
    execute: vi.fn(),
  };

  const optionalSelection: NativeFeatureSelection = { kind: 'optional', forwarded: {}, maxOutputTokens: 64 };
  const requiredSelection: NativeFeatureSelection = { kind: 'required', forwarded: {}, maxOutputTokens: 64 };

  it('verifies prepareNativeMessages selection and refusal contracts', () => {
    const attempt = { nativeMessages: capability } as unknown as PreparedRouteAttempt;
    const target = { providerId: 'anthropic', transportProviderId: 't-1', model: 'claude-sonnet-5' };

    expect(prepareNativeMessages({ kind: 'none' }, attempt, target)).toBeUndefined();
    expect(prepareNativeMessages(optionalSelection, attempt, target)).toEqual({
      capability, anthropicVersion: '2023-06-01',
    });
    expect(prepareNativeMessages(optionalSelection, {} as PreparedRouteAttempt, target)).toBeUndefined();

    expect(() => prepareNativeMessages(requiredSelection, {} as PreparedRouteAttempt, target))
      .toThrow(NativeAttemptRefusal);
    expect(() => prepareNativeMessages(requiredSelection, attempt, { ...target, providerId: 'openai' }))
      .toThrow(NativeAttemptRefusal);
    expect(() => prepareNativeMessages(requiredSelection, attempt, { ...target, model: 'claude-opus-5' }))
      .toThrow(NativeAttemptRefusal);
  });

  it('guarantees refuseNativeAttempt protects against failing release or settlement', async () => {
    const attempt = { releaseCancelled: vi.fn().mockRejectedValue(new Error('release boom')) } as unknown as PreparedRouteAttempt;
    const settle = vi.fn().mockRejectedValue(new Error('settle boom'));

    const error = await refuseNativeAttempt(attempt, settle);
    expect(attempt.releaseCancelled).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(error.kind).toBe('native-required');

    const mapped = toProviderShapedError('anthropic-messages', error);
    expect(mapped.status).toBe(400);
    expect((mapped.body as { error: { message: string } }).error.message)
      .toContain('safeguards is not supported by this gateway route');
  });
});
