import { startGatewayHost } from '@sentropic/llm-gateway/node';
import { stubGatewayConfig } from '@sentropic/llm-gateway';
import { InMemoryRoutePlanner } from '@sentropic/llm-mesh';
const model = 'gpt-6.1-sol';
const mesh = {
  ownerScopeRef: 'owner-a', keyring: { getSecret: async () => process.env.GW_TEST_DEK! },
  unlockKeyring: async () => undefined,
  resolveOwner: (caller: any, context: any) => ({ ownerScopeRef: caller.ownerScopeRef, tenantId: 't', principalId: 'owner',
    workspaceId: caller.workspaceRef, source: 'packed-fixture', correlationId: context.requestId }),
  gateway: { config: stubGatewayConfig, routeMetering: { settleRoute: async () => undefined },
    routePlanner: new InMemoryRoutePlanner({ directory: {
      listEligible: async () => [{ accountRef: 'account-a', diagnosticAccountRef: 'opaque-a', targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: [model], enrollmentCompletedAt: '2026-10-01T00:00:00Z', readiness: 'ready', revision: '1' }],
      prepareAttempt: async () => ({ attemptRef: 'synthetic-attempt',
        generate: async () => ({ id: 'synthetic-response', providerId: 'openai', modelId: model, text: 'synthetic',
          message: { role: 'assistant', content: 'synthetic' }, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
        stream: async () => { throw new Error('fixture stream unused'); },
        markCommitted: async () => undefined, recordOutcome: async () => undefined,
        complete: async () => undefined, releaseCancelled: async () => undefined,
      }),
    } }),
  },
};
const host = await startGatewayHost({ stateDir: process.env.GW_TEST_STATE_DIR!, mesh, listen: { host: '127.0.0.1', port: 0 } });
process.on('message', async () => {
  await host.stop().catch(() => undefined);
  process.send?.({ stopped: true }, () => process.exit(0));
});
process.send?.({ endpoint: host.endpoint, controlSocket: host.controlSocket, ready: (await host.readiness()).ready });
