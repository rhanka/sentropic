/**
 * Test harness: assemble a v0 personal-passthrough gateway over a 2-account
 * in-memory llm-mesh pool, a deterministic token verifier, a fixture transport,
 * and a recording metering sink. No network, no docker — fixtures only.
 */

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

/** The default verified principal id `valid-user-a` resolves to (caller==owner). */
export const OWNER_USER_A = 'user-a';

/**
 * Two enrolled personal accounts on the Claude-Code transport (caller-owned by
 * `OWNER_USER_A`) — the sticky-selection tests assert over these two. Plus one
 * Codex account so the OpenAI-wire (`gpt-5.5` -> `codex`) tests can select
 * successfully. All owned by the caller (personal-passthrough; caller==provider),
 * carried in the gateway-owned `metadata.ownerUserId`.
 */
export const twoAccountPool = (owner: string = OWNER_USER_A): AccountTransportAccount[] => [
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
    metadata: { ownerUserId: owner },
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
    metadata: { ownerUserId: owner },
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
    metadata: { ownerUserId: owner },
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
  /** Gateway mode (default personal-passthrough). Set `cross-user-pool` for #7 fail-closed tests. */
  readonly mode?: GatewayConfig['mode'];
}

export interface Harness {
  readonly app: ReturnType<typeof createGatewayRouter>;
  readonly metering: RecordingMeteringSink;
  readonly pool: CoordinatorPoolState;
  readonly config: GatewayConfig;
}

/** A correlation source that echoes the caller-supplied `x-correlation-id`. */
export const buildHarness = (options: HarnessOptions): Harness => {
  const accounts = options.accounts ?? twoAccountPool();
  const pool = new CoordinatorPoolState({
    accounts,
    crossUserPoolEnabled: options.crossUserPoolEnabled ?? false,
  });
  const config: GatewayConfig = {
    mode: options.mode ?? DEFAULT_GATEWAY_MODE,
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
  return { app, metering, pool, config };
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

/**
 * Build Anthropic-SDK-style headers: the sentropic key as `x-api-key` (+
 * `anthropic-version`), NO `Authorization` (#10 drop-in transparency).
 */
export const apiKeyHeaders = (
  principal: string,
  correlationId?: string,
): Record<string, string> => ({
  'x-api-key': `valid-${principal}`,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
  ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
});

/** Fixture defaults for Gemini Code Assist transport testing. */
export interface GeminiCodeAssistFixture {
  readonly accessToken: string;
  readonly projectId: string;
  readonly modelId: string;
}

/**
 * Create a mock transport fixture for Gemini Code Assist with sensible defaults.
 * Override any field via the optional `overrides` parameter.
 */
export const createGeminiCodeAssistFixture = (
  overrides?: Partial<GeminiCodeAssistFixture>,
): GeminiCodeAssistFixture => ({
  accessToken: overrides?.accessToken ?? 'fake-gca-access-token-xyz',
  projectId: overrides?.projectId ?? 'fake-gca-project-42',
  modelId: overrides?.modelId ?? 'google/gemini-3.5-flash@gcp',
});
