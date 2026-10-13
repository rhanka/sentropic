import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { vi } from 'vitest';
import { createGwNamespaceModule, GW_AUTHOR, type CreateGwNamespaceModuleOptions } from '../../src/routes/namespaces/gw';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { authHonoSessionService } from '../../src/services/auth/session-adapter';
import * as workspaces from '../../src/services/workspace-service';
import * as access from '../../src/services/workspace-access';
import { routePartitionHash } from '../../src/services/llm-metering';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';
import { createAnthropicNativePort } from '../../src/services/llm-runtime/anthropic-native';

export const MODEL = 'claude-sonnet-5';
export const message = { model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'fixture' }] };
/** Read-only control/session seams: never provision or delete operator users, sessions or cutovers. */
export const gwNativeFixture = async (enabled = true, options: CreateGwNamespaceModuleOptions = {}) => {
  const tenant = `native-${randomUUID()}`;
  const users = [`${tenant}-a`, `${tenant}-b`];
  const tokens = new Map([['a', users[0]!], ['a2', users[0]!], ['b', users[1]!]]);
  vi.spyOn(authHonoSessionService, 'validateSessionToken').mockImplementation(async token => {
    const userId = tokens.get(token);
    if (!userId) return null;
    return { session: { userId, sessionId: token }, sessionRecord: { createdAt: new Date() }, role: 'user' } as
      NonNullable<Awaited<ReturnType<typeof authHonoSessionService.validateSessionToken>>>;
  });
  vi.spyOn(workspaces, 'ensureWorkspaceForUser').mockResolvedValue({ workspaceId: `${tenant}-ws` });
  vi.spyOn(access, 'isWorkspaceDeleted').mockResolvedValue(false);
  const tenants = { [tenant]: { product: users } };
  const partition = { revision: tenant, hash: routePartitionHash(tenant, tenants), tenants };
  const control = clusterMeshAdapter.sessionControl!;
  const cutover = vi.spyOn(control.cutovers, 'find').mockResolvedValue({
    compositionRoot: 'product', namespace: '/gw', status: 'active', activeAuthor: GW_AUTHOR,
    selectedGenerationId: control.runtime.generation.generationId,
  } as NonNullable<Awaited<ReturnType<typeof control.cutovers.find>>>);
  const record = vi.fn(async () => undefined);
  const credential = vi.fn(async () => ({ providerId: 'anthropic', credential: 'fixture-server-key', source: 'environment' as const }));
  const runtime = {
    nativeMessages: vi.fn(async payload => {
      payload.onResponseStarted();
      return { kind: 'json' as const, status: 200 as const, headers: {}, body: { model: MODEL,
        content: [{ type: 'text', text: 'native' }], usage: { input_tokens: 2, cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0, output_tokens: 1 }, safeguard_results: { action: 'allow' } } };
    }),
    nativeCountTokens: vi.fn(async () => ({ kind: 'json' as const, status: 200 as const,
      headers: {}, body: { input_tokens: 17, extension: { retained: true } } })),
  };
  const port = createAnthropicNativePort({ modelIds: [MODEL], runtime, record,
    dependencies: { resolveProviderCredential: credential } });
  const generate = vi.fn(async () => ({ id: 'canonical', providerId: 'anthropic', modelId: MODEL,
    message: { role: 'assistant' as const, content: 'canonical' }, text: 'canonical', toolCalls: [],
    finishReason: 'stop' as const, usage: { inputTokens: 2, outputTokens: 1 } }));
  const plane = createApplicationGatewayRoutePlane({ nativeMessages: enabled, nativePort: port,
    dispatch: { generate, stream: vi.fn() } });
  const quote = vi.spyOn(plane.planner, 'quote');
  const budget = { admit: vi.fn(async () => ({ kind: 'admitted' as const, holdRef: 'fixture-hold' })),
    markDispatched: vi.fn(async () => undefined), release: vi.fn(async () => undefined), probe: async () => true };
  const settlement = { settleRoute: vi.fn(async () => undefined), probe: async () => true };
  const caller = vi.fn(context => {
    const user = context.get('user');
    return { tenantId: tenant, workspaceId: user.workspaceId, principalId: user.userId,
      ownerScopeRef: `workspace:${user.workspaceId}:principal:${user.userId}`, source: 'fixture', correlationId: randomUUID() };
  });
  const module = await createGwNamespaceModule({ routePlane: plane, nativeMessagesEnabled: enabled,
    budget, settlement, resolveCaller: caller, identityReady: async () => true,
    partition: { load: () => partition, expected: () => partition }, ...options });
  const app = new Hono().route('/api/v1/gw', module.createRouter());
  const post = (body: unknown = message, headers: Record<string, string> = {}, path = '/v1/messages', token = 'a') =>
    app.request(`/api/v1/gw${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  return { app, post, tenant, users, partition, cutover, caller, plane, quote, budget, settlement, runtime, credential, record, generate };
};
