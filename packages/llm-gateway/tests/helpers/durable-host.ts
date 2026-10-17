import { InMemoryRoutePlanner, type GenerateRequest, type GenerateResponse, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import { stubGatewayConfig } from '../../src/stubs.js';
import type { MeshBinding } from '../../src/node/host-types.js';
export const model = 'gpt-6.1-sol';
export const durableHostFixture = (key = 'a') => {
  const calls: GenerateRequest[] = [];
  const mesh: MeshBinding = {
    ownerScopeRef: 'owner-a',
    keyring: { getSecret: async () => key.repeat(64) }, unlockKeyring: async () => undefined,
    resolveOwner: (caller, context) => ({ ownerScopeRef: caller.ownerScopeRef, tenantId: 'tenant',
      principalId: 'owner', workspaceId: caller.workspaceRef, source: 'fixture', correlationId: context.requestId }),
    gateway: { config: stubGatewayConfig, routeMetering: { settleRoute: () => undefined },
      routePlanner: new InMemoryRoutePlanner({ directory: {
        listEligible: async () => [{ accountRef: 'internal-a', diagnosticAccountRef: 'account-a', targetProviderId: 'openai', transportProviderId: 'codex',
          supportedModelIds: [model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' }],
        prepareAttempt: async () => ({ attemptRef: 'attempt-a',
          generate: async (request: GenerateRequest): Promise<GenerateResponse> => {
            calls.push(request);
            return { id: 'response', providerId: 'openai', modelId: model, message: { role: 'assistant', content: 'synthetic' },
              text: 'synthetic', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
          }, stream: async () => { throw new Error('fixture stream unused'); },
          markCommitted: async () => undefined, complete: async () => undefined,
          releaseCancelled: async () => undefined, recordOutcome: async () => undefined,
        }) as unknown as PreparedRouteAttempt,
      } }),
    },
  };
  return { mesh, calls };
};
