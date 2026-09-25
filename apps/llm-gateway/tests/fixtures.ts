// Deterministic fixture ports for host tests: generated caller identity, a fake
// provider dispatch and an in-memory settlement sink. No provider call, no secret.
import { vi } from 'vitest';
import type { CallerAuthPort, RouteRequestSettlement } from '@sentropic/llm-gateway';
import type { GenerateResponse, StreamEvent, StreamRequest } from '@sentropic/llm-mesh';

import { createRoutingDependency, type HostDependencies } from '../src/app';
import type { HostConfig } from '../src/config';

export const testConfig = (overrides: Partial<HostConfig> = {}): HostConfig => ({
  mode: 'test', port: 0, host: '127.0.0.1', drainTimeoutMs: 1_000, ...overrides,
});

export const AUTHORIZATION = 'Bearer fixture-caller';

export const fixtureCallerAuth: CallerAuthPort = {
  async verify(headers, context) {
    if (headers.authorization !== AUTHORIZATION) return { ok: false, reason: 'unknown caller' };
    return {
      ok: true,
      cost: {
        tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
        ownerScopeRef: 'workspace:workspace-1:principal:user-1',
        source: 'llm-gateway-host-test', correlationId: context.requestId,
      },
    };
  },
};

/** A provider stream that emits `one`, then waits for `release()` (or the abort signal) before `two`. */
export const gatedStream = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const finished = vi.fn();
  const stream = vi.fn(async (_subject: unknown, _workspace: unknown, _target: unknown, request: StreamRequest) =>
    (async function* (): AsyncGenerator<StreamEvent> {
      try {
        yield { type: 'content_delta', data: { delta: 'one' } };
        await new Promise<void>((resolve, reject) => {
          void gate.then(resolve);
          const signal = (request as { signal?: AbortSignal }).signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield { type: 'content_delta', data: { delta: 'two' } };
        yield { type: 'done', data: { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 } } };
      } finally {
        finished();
      }
    })());
  return { stream, release: () => release(), finished };
};

export const fixtureDependencies = (stream = gatedStream().stream) => {
  const settlements: RouteRequestSettlement[] = [];
  const generate = vi.fn(async (): Promise<GenerateResponse> => ({
    id: 'fixture-response', providerId: 'openai' as const, modelId: 'gpt-fixture',
    message: { role: 'assistant' as const, content: 'fixture answer' }, text: 'fixture answer',
    toolCalls: [], finishReason: 'stop' as const, usage: { inputTokens: 2, outputTokens: 1 },
  }));
  const dependencies: HostDependencies = {
    identity: { callerAuth: fixtureCallerAuth, ready: async () => true },
    routing: createRoutingDependency({
      councilRevision: 'fixture-v1',
      targets: {
        async resolve(_subject, requestedModel) {
          return { requestedModel, providerId: 'openai', modelId: requestedModel, transportProviderId: 'fixture', reason: 'exact' };
        },
      },
      catalog: { listModels: () => [{ modelId: 'gpt-fixture', providerId: 'openai' }] },
      dispatch: { generate, stream },
      ready: async () => true,
    }),
    settlement: { metering: { settleRoute: (value) => { settlements.push(value); } }, ready: async () => true },
  };
  return { dependencies, settlements, generate };
};

export const chatRequest = (stream: boolean): RequestInit => ({
  method: 'POST',
  headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-fixture', stream, messages: [{ role: 'user', content: 'hello' }] }),
});
