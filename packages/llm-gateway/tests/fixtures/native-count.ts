import { vi } from 'vitest';
import { createGatewayRouter, NativeCountTokensRateLimiter, type CreateGatewayRouterOptions,
  type NativeCountTokensRequest, type NativeCountTokensResult, type PreparedNativeCountTokens,
  type NativeCountTokensPort, type CallerAuthPort } from '../../src/index.js';
import { nativeHarness } from './native-flow.js';

export const COUNT_COST = { tenantId: 'count-tenant', principalId: 'count-principal',
  workspaceId: 'count-workspace', ownerScopeRef: 'count-owner', source: 'test', correlationId: 'cost-correlation' };
export const countHarness = (overrides: Partial<CreateGatewayRouterOptions> = {},
  handler?: (request: NativeCountTokensRequest) => Promise<NativeCountTokensResult>) => {
  const h = nativeHarness();
  const auth = vi.fn<CallerAuthPort['verify']>(async () => ({ ok: true as const, cost: COUNT_COST }));
  const execute = vi.fn<(request: NativeCountTokensRequest) => Promise<NativeCountTokensResult>>(handler ?? (async () => ({ kind: 'json' as const, status: 200 as const,
    headers: {}, body: { input_tokens: 0, future: { kept: true } } })));
  const capability: PreparedNativeCountTokens = { providerId: 'anthropic', modelId: h.model,
    apiVersions: ['2023-06-01'], execute };
  const prepare = vi.fn<NativeCountTokensPort['prepare']>(async () => capability);
  const port = { modelIds: [h.model], prepare };
  const rate = new NativeCountTokensRateLimiter();
  const config = { ...h.deps.config, callerAuth: { verify: auth } };
  const options: CreateGatewayRouterOptions = { config, routePlanner: h.deps.routePlanner,
    routeMetering: h.deps.metering, budget: h.deps.budget, requestId: () => 'req-count',
    nativeMessagesEnabled: true, nativeCountTokens: port, nativeCountRate: rate, ...overrides };
  return { h, model: h.model, auth, execute, prepare, port, rate, capability, options,
    app: createGatewayRouter(options) };
};
export const sendCount = (h: ReturnType<typeof countHarness>, body: unknown = { model: h.model },
  headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> =>
  Promise.resolve(h.app.request('/v1/messages/count_tokens', { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer caller-session', ...headers }, signal }));
