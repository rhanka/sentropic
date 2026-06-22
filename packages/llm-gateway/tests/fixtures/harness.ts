/**
 * Test harness: assemble a v0 personal-passthrough gateway over a 2-account
 * in-memory llm-mesh pool, a deterministic token verifier, a fixture transport,
 * and a recording metering sink. No network, no docker — fixtures only.
 */

import { InMemoryAccountTransportCoordinator } from '@sentropic/llm-mesh';
import type { AccountTransportAccount } from '@sentropic/llm-mesh';

import {
  CoordinatorPoolState,
  PassthroughAuthResolver,
  PersonalPassthroughCallerAuth,
  PassthroughDispatch,
  RecordingMeteringSink,
  createStaticTargetResolver,
  createGatewayRouter,
  DEFAULT_GATEWAY_MODE,
  type GatewayConfig,
  type VerifiedPrincipal,
  type VerifyToken,
} from '../../src/index.js';
import { FixtureTransport } from './transport.js';

/**
 * Two enrolled personal accounts on the Claude-Code transport (caller-owned) —
 * the sticky-selection tests assert over these two. Plus one Codex account so
 * the OpenAI-wire (`gpt-5.5` -> `codex`) tests can select successfully. All
 * caller-owned (personal-passthrough; caller == provider).
 */
export const twoAccountPool = (): AccountTransportAccount[] => [
  {
    accountId: 'acct-alpha',
    accountLabel: 'alpha',
    targetProviderId: 'anthropic',
    transportProviderId: 'claude-code',
    accessToken: 'SECRET-ALPHA-TOKEN-xyz',
    refreshToken: 'SECRET-ALPHA-REFRESH-xyz',
    status: 'active',
    priority: 10,
    modelIds: ['claude-sonnet-4-6', 'claude-opus-4-7'],
  },
  {
    accountId: 'acct-beta',
    accountLabel: 'beta',
    targetProviderId: 'anthropic',
    transportProviderId: 'claude-code',
    accessToken: 'SECRET-BETA-TOKEN-xyz',
    refreshToken: 'SECRET-BETA-REFRESH-xyz',
    status: 'active',
    priority: 10,
    modelIds: ['claude-sonnet-4-6', 'claude-opus-4-7'],
  },
  {
    accountId: 'acct-codex',
    accountLabel: 'codex',
    targetProviderId: 'openai',
    transportProviderId: 'codex',
    accessToken: 'SECRET-CODEX-TOKEN-xyz',
    refreshToken: 'SECRET-CODEX-REFRESH-xyz',
    status: 'active',
    priority: 10,
    modelIds: ['gpt-5.5'],
  },
];

/** The two Claude-Code accounts only (for sticky tests asserting a 2-set). */
export const claudeCodePool = (): AccountTransportAccount[] =>
  twoAccountPool().filter((a) => a.transportProviderId === 'claude-code');

/** A deterministic token verifier: `valid-<principal>` -> that principal. */
export const fixtureVerifyToken: VerifyToken = {
  verify(token: string): VerifiedPrincipal | undefined {
    if (!token.startsWith('valid-')) {
      return undefined;
    }
    const principalId = token.slice('valid-'.length);
    return {
      tenantId: 'tenant-1',
      principalId,
      workspaceId: 'ws-1',
      source: 'layer-c',
      budgetScope: 'personal',
    };
  },
};

export interface HarnessOptions {
  readonly transport: FixtureTransport;
  readonly accounts?: AccountTransportAccount[];
  readonly crossUserPoolEnabled?: boolean;
}

export interface Harness {
  readonly app: ReturnType<typeof createGatewayRouter>;
  readonly metering: RecordingMeteringSink;
  readonly coordinator: InMemoryAccountTransportCoordinator;
  readonly config: GatewayConfig;
}

/** A correlation source that echoes the caller-supplied `x-correlation-id`. */
export const buildHarness = (options: HarnessOptions): Harness => {
  const accounts = options.accounts ?? twoAccountPool();
  const coordinator = new InMemoryAccountTransportCoordinator(accounts);
  const pool = new CoordinatorPoolState({
    coordinator,
    accounts,
    crossUserPoolEnabled: options.crossUserPoolEnabled ?? false,
  });
  const config: GatewayConfig = {
    mode: DEFAULT_GATEWAY_MODE,
    crossUserPoolEnabled: options.crossUserPoolEnabled ?? false,
    callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: fixtureVerifyToken }),
    pool,
    authResolver: new PassthroughAuthResolver(),
    dispatch: new PassthroughDispatch({ transport: options.transport }),
  };
  const metering = new RecordingMeteringSink();
  const app = createGatewayRouter({
    config,
    resolveTarget: createStaticTargetResolver({
      mappings: {
        'claude-sonnet-4-6': {
          providerId: 'anthropic',
          transportProviderId: 'claude-code',
          model: 'claude-sonnet-4-6',
        },
        'claude-opus-4-7': {
          providerId: 'anthropic',
          transportProviderId: 'claude-code',
          model: 'claude-opus-4-7',
        },
        'gpt-5.5': {
          providerId: 'openai',
          transportProviderId: 'codex',
          model: 'gpt-5.5',
        },
      },
    }),
    metering,
    requestId: () => 'req_fixture_id',
  });
  return { app, metering, coordinator, config };
};

/** Build an Authorization header for a valid principal + optional correlation id. */
export const authHeaders = (
  principal: string,
  correlationId?: string,
): Record<string, string> => ({
  authorization: `Bearer valid-${principal}`,
  'content-type': 'application/json',
  ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
});
