/**
 * Native count_tokens harness (Lot 3 round 2): a personal-passthrough gateway
 * over the standard fixture pool, plus a host-owned NativeCountTokensPort with
 * a recording prepare/execute pair. The port models the host transport that
 * owns the provider credential — the gateway relays the caller body to it and
 * returns the provider count verbatim.
 */

import { vi } from 'vitest';
import {
  createGatewayRouter,
  createStaticTargetResolver,
  NativeCountTokensRateLimiter,
  type CreateGatewayRouterOptions,
  type NativeCountTokensPort,
  type NativeCountTokensRequest,
  type NativeCountTokensResult,
  type PreparedNativeCountTokens,
} from '../../src/index.js';
import { buildHarness } from './harness.js';
import { FixtureTransport } from './transport.js';

export const COUNT_MODEL = 'claude-sonnet-4-6';

export const countBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: COUNT_MODEL,
  messages: [{ role: 'user', content: 'ping' }],
  ...extra,
});

export const countHarness = (
  overrides: Partial<CreateGatewayRouterOptions> = {},
  handler?: (request: NativeCountTokensRequest) => Promise<NativeCountTokensResult>,
) => {
  const transport = new FixtureTransport();
  const h = buildHarness({ transport });
  const execute = vi.fn<(request: NativeCountTokensRequest) => Promise<NativeCountTokensResult>>(
    handler ?? (async () => ({ kind: 'json', status: 200, headers: {},
      body: { input_tokens: 17 } })),
  );
  const capability: PreparedNativeCountTokens = {
    providerId: 'anthropic',
    modelId: COUNT_MODEL,
    apiVersions: ['2023-06-01'],
    execute,
  };
  const prepare = vi.fn<NativeCountTokensPort['prepare']>(async () => capability);
  const port: NativeCountTokensPort = { modelIds: [COUNT_MODEL], prepare };
  // Fresh limiter per harness (R row 47b parity): tests stay isolated; pass
  // `nativeCountRate: undefined` explicitly to exercise the shared default.
  const rate = new NativeCountTokensRateLimiter();
  const app = createGatewayRouter({
    config: h.config,
    resolveTarget: createStaticTargetResolver({
      mappings: {
        [COUNT_MODEL]: {
          providerId: 'anthropic',
          transportProviderId: 'claude-code',
          model: COUNT_MODEL,
        },
      },
    }),
    metering: h.metering,
    requestId: () => 'count-req',
    nativeCountTokens: port,
    nativeCountRate: rate,
    ...overrides,
  });
  return { h, transport, model: COUNT_MODEL, execute, prepare, port, capability, rate, app };
};

export const sendCount = (
  h: ReturnType<typeof countHarness>,
  body: unknown = countBody(),
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> => Promise.resolve(h.app.request('/v1/messages/count_tokens', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', authorization: 'Bearer valid-user-a', ...headers },
  signal,
}));
