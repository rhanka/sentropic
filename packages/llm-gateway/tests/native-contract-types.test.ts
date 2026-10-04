import { describe, expect, it, vi } from 'vitest';
import { NativeAttemptRefusal, prepareNativeMessages } from '../src/route-native.js';
import { refuseNativeAttempt } from '../src/route-flow-core.js';
import { toProviderShapedError } from '../src/index.js';
import { GatewayError } from '../src/router/errors.js';
import { runRouteJsonFlow } from '../src/route-json-flow.js';
import { runRouteStreamFlow } from '../src/route-stream-flow.js';
import { budgetConfig, fixtureQuote, quotingPlanner, recordingBudget } from './fixtures/budget.js';
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

  it.each(['json', 'stream'] as const)(
    'enforces required-mode skew rejection, zero-dispatch and single release/settlement across %s flow',
    async flowKind => {
      const cases = [
        { name: 'missing capability', attemptCapability: undefined },
        { name: 'mismatched model', attemptCapability: { ...capability, modelId: 'claude-opus-5' } },
        { name: 'mismatched version', attemptCapability: { ...capability, apiVersions: ['2024-01-01'] } },
      ];

      for (const tc of cases) {
        const generate = vi.fn();
        const stream = vi.fn();
        const hooks: string[] = [];
        const attempt = {
          attemptRef: 'att-1',
          nativeMessages: tc.attemptCapability,
          generate,
          stream,
          async releaseCancelled() { hooks.push('cancelled'); },
          async recordOutcome() { hooks.push('outcome'); },
        } as unknown as PreparedRouteAttempt;

        const { planner } = quotingPlanner([attempt], {
          quote: () => fixtureQuote({ requestedModel: 'claude-sonnet-5', candidates: [{
            providerId: 'anthropic', modelId: 'claude-sonnet-5', reason: 'exact',
            allowance: { inputTokens: 100, outputTokens: 64 }, outputCeilingEnforced: true,
          }] }),
        });
        const recorder = recordingBudget();
        const deps = { config: budgetConfig, routePlanner: planner, budget: recorder.options, metering: recorder.metering };
        const req = {
          wire: 'anthropic-messages' as const,
          headers: { 'anthropic-beta': 'safeguards-2026-09-01' },
          authContext: { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'req-test' },
          model: 'claude-sonnet-5',
          stream: flowKind === 'stream',
          body: { model: 'claude-sonnet-5', safeguards: { enabled: true }, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] },
        };

        const runner = flowKind === 'json' ? () => runRouteJsonFlow(deps, req) : () => runRouteStreamFlow(deps, req);
        const err = await runner().then(() => { throw new Error('expected refusal'); }, (e: unknown) => e);

        expect(err).toBeInstanceOf(GatewayError);
        expect((err as GatewayError).kind).toBe('native-required');
        expect(generate).not.toHaveBeenCalled();
        expect(stream).not.toHaveBeenCalled();
        expect(hooks).toEqual(['cancelled']);
        expect(recorder.events).toEqual(['admit', 'release:hold-1', 'settle']);
        expect(recorder.settlements).toHaveLength(1);
        expect(recorder.settlements[0]!.attempts).toEqual([]);
        expect(recorder.settlements[0]!.outcome).toBe('failed');
      }

      const failingCleanupAttempt = {
        attemptRef: 'att-fail',
        nativeMessages: undefined,
        generate: vi.fn(), stream: vi.fn(),
        async releaseCancelled() { throw new Error('cleanup failed'); },
      } as unknown as PreparedRouteAttempt;
      const { planner: p1 } = quotingPlanner([failingCleanupAttempt], {
        quote: () => fixtureQuote({ requestedModel: 'claude-sonnet-5', candidates: [{
          providerId: 'anthropic', modelId: 'claude-sonnet-5', reason: 'exact',
          allowance: { inputTokens: 100, outputTokens: 64 }, outputCeilingEnforced: true,
        }] }),
      });
      const r1 = recordingBudget();
      const deps1 = { config: budgetConfig, routePlanner: p1, budget: r1.options, metering: r1.metering };
      const req1 = {
        wire: 'anthropic-messages' as const,
        headers: { 'anthropic-beta': 'safeguards-2026-09-01' },
        authContext: { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'req-test' },
        model: 'claude-sonnet-5', stream: flowKind === 'stream',
        body: { model: 'claude-sonnet-5', safeguards: { enabled: true }, max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] },
      };
      const runner1 = flowKind === 'json' ? () => runRouteJsonFlow(deps1, req1) : () => runRouteStreamFlow(deps1, req1);
      const err1 = await runner1().then(() => { throw new Error('expected refusal'); }, (e: unknown) => e);
      expect((err1 as GatewayError).kind).toBe('native-required');

      const normalAttempt = {
        attemptRef: 'att-settle-fail',
        nativeMessages: undefined,
        generate: vi.fn(), stream: vi.fn(),
        async releaseCancelled() {},
      } as unknown as PreparedRouteAttempt;
      const { planner: p2 } = quotingPlanner([normalAttempt], {
        quote: () => fixtureQuote({ requestedModel: 'claude-sonnet-5', candidates: [{
          providerId: 'anthropic', modelId: 'claude-sonnet-5', reason: 'exact',
          allowance: { inputTokens: 100, outputTokens: 64 }, outputCeilingEnforced: true,
        }] }),
      });
      const r2 = recordingBudget();
      const failingMetering = { async settleRoute() { throw new Error('settlement failed'); } };
      const deps2 = { config: budgetConfig, routePlanner: p2, budget: r2.options, metering: failingMetering };
      const runner2 = flowKind === 'json' ? () => runRouteJsonFlow(deps2, req1) : () => runRouteStreamFlow(deps2, req1);
      const err2 = await runner2().then(() => { throw new Error('expected refusal'); }, (e: unknown) => e);
      expect((err2 as GatewayError).kind).toBe('native-required');
    },
  );
});
