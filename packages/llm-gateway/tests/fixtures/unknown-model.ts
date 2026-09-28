/** Lot 1 unknown-model fixtures: REAL mesh planner + routed router + recording dispatch. No network, no copied routing table. */
import {
  InMemoryRoutePlanner, type PreparedRouteAttempt, type RoutePlanner,
} from '@sentropic/llm-mesh';
import {
  PersonalPassthroughCallerAuth, createGatewayRouter, type GatewayBudgetOptions,
  type RouteAttemptDispatchPort, type RouteRequestSettlement,
} from '../../src/index.js';
import { stubGatewayConfig } from '../../src/stubs.js';

/** Fixture unknown model frozen across the Lot 1 router-matrix tests. */
export const UNKNOWN_MODEL = 'no-such-model';
/** Catalog model the fixture directory enrolls (known-model control). */
export const KNOWN_MODEL = 'gemini-3.5-flash';

const verifyToken = {
  verify(token: string) {
    if (token !== 'valid-test') return undefined;
    return { tenantId: 'tenant-1', principalId: 'user-1', workspaceId: 'ws-1',
      source: 'test', budgetScope: 'personal' as const };
  },
};

export const unknownCallerAuth = new PersonalPassthroughCallerAuth({ verifyToken });

/** One ready account for the given catalog ids. */
export const meshDirectoryFor = (models: readonly string[]) => ({
  async listEligible() {
    return [{ accountRef: 'internal-a', diagnosticAccountRef: 'acct_a', targetProviderId: 'gemini',
      transportProviderId: 'cloud-code', supportedModelIds: [...models],
      enrollmentCompletedAt: '2026-08-01T00:00:00Z', readiness: 'ready' as const, revision: 'r1' }];
  },
  async prepareAttempt(): Promise<PreparedRouteAttempt> { throw new Error('unused'); },
});

/** Empty directory: every known model has no eligible route. */
export const emptyMeshDirectory = () => ({
  async listEligible() { return []; },
  async prepareAttempt(): Promise<PreparedRouteAttempt> { throw new Error('unused'); },
});

type MeshDirectory = ReturnType<typeof meshDirectoryFor> | ReturnType<typeof emptyMeshDirectory>;

export const realMeshPlanner = (directory: MeshDirectory): RoutePlanner =>
  new InMemoryRoutePlanner({ directory });

export interface UnknownRouterCalls {
  readonly settlements: RouteRequestSettlement[];
  readonly dispatch: { generate: number; stream: number };
}

export const recordingDispatch = (calls: UnknownRouterCalls['dispatch'], error?: unknown,
): RouteAttemptDispatchPort => ({
  async generate() { calls.generate += 1; if (error) throw error; throw new Error('unused'); },
  async stream() { calls.stream += 1; if (error) throw error; throw new Error('unused'); },
});

/** Real router + real mesh. `budget` selects the quote path; else plan-only. */
export const unknownModelRouter = (input: {
  readonly planner: RoutePlanner; readonly calls: UnknownRouterCalls; readonly budget?: GatewayBudgetOptions;
}) => createGatewayRouter({
  config: { ...stubGatewayConfig, callerAuth: unknownCallerAuth },
  routePlanner: input.planner,
  routeMetering: { async settleRoute(value: RouteRequestSettlement) { input.calls.settlements.push(value); } },
  routeDispatch: recordingDispatch(input.calls.dispatch),
  ...(input.budget ? { budget: input.budget } : {}),
  requestId: () => 'req_unknown',
});

export const authHeaders = { authorization: 'Bearer valid-test', 'content-type': 'application/json' };

export const sendUnknown = (
  app: ReturnType<typeof unknownModelRouter>, path: string, model: unknown, stream: boolean,
  headers: Record<string, string> = authHeaders,
): Promise<Response> => Promise.resolve(app.request(path, { method: 'POST', headers,
  body: JSON.stringify({ model, max_tokens: 64, stream, messages: [{ role: 'user', content: 'hello' }] }) }));
