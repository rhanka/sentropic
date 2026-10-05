/**
 * Product `/api/v1/gw` (Lot D B3c, spec D2/D5): the SAME cluster-mesh gateway namespace module as
 * the standalone host (`createGatewayNamespaceModule`, one registry, one router per mount), with
 * real budget admission, B2 caller identity, D2 partition rejection, ledger settlement and
 * readiness. Product principals always pass admission. The author fence only READS the `/gw`
 * cutover: no boot- or request-time activation, and nothing here writes the dispatch generation.
 */
import {
  createClusterMeshModules, type ClusterMeshHonoNamespaceModule, type ClusterMeshModules,
} from '@sentropic/cluster-mesh';
import { createGatewayNamespaceModule } from '@sentropic/cluster-mesh/compose/gateway';
import type {
  BudgetAdmissionPort, CallerAuthPort, CostContext, GatewayConfig, RouteMeteringSink,
} from '@sentropic/llm-gateway';
import { gatewayRequestBodyLimit, type RequestBodyLimitOptions } from '@sentropic/llm-gateway';
import { sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';

import { db } from '../../db/client';
import { logger } from '../../logger';
import { requireAuth, type AuthUser } from '../../middleware/auth';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { createLlmCallerIdentity, type LlmCallerIdentity } from '../../services/llm-identity/caller-auth';
import { createLlmIdentityDirectory } from '../../services/llm-identity/directory';
import {
  createBudgetAdmission, createRoutePartition, createRouteSettlement, settlementModeMiddleware, withRoutePartition,
  withSettlementMode, type RoutePartitionConfig, type RoutePartitionRevision, type RoutePartitionSource,
} from '../../services/llm-metering';
import { createApplicationGatewayRoutePlane } from '../../services/llm-runtime/gateway-route-plane';
import { gatewayNativeMessagesEnabled } from '../../services/llm-runtime/gateway-native-config';
import { gatewayStartupRecord, resolveGatewayPackageVersion } from '../../services/llm-runtime/gateway-package-version';

export const GW_AUTHOR = 'llm-gateway-module';
export const GW_PATHS = [
  // Gateway 0.20 registers the global body-cap middleware and count endpoint.
  '/*', '/healthz', '/readyz', '/v1/*', '/v1/models', '/v1/messages', '/v1/messages/count_tokens', '/v1/chat/completions',
] as const;
/** Default reserved output ceiling for a request without max tokens (the Claude code default). */
export const GW_DEFAULT_OUTPUT_TOKENS = 4_096;
const CALLER_TOKEN_HEADER = 'x-sentropic-internal-gateway-caller';
const PROBE_TIMEOUT_MS = 2_000;
const CUTOVER_KEY = { compositionRoot: 'product' as const, namespace: '/gw' as const };

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh gateway cutover control is not configured');

/** Reads the `/gw` cutover: the product author must already be active for this generation. */
const readActiveCutover = async () => {
  const record = await control.cutovers.find(CUTOVER_KEY);
  return record?.status === 'active' && record.activeAuthor === GW_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId ? record : undefined;
};

const applyAuthorFence = (router: Hono): void => {
  for (const path of GW_PATHS) {
    router.use(path, async (c, next) => {
      try {
        if (!await readActiveCutover()) return c.json({ error: 'wrong_author' }, 503);
      } catch {
        return c.json({ error: 'gateway_control_unavailable' }, 503);
      }
      await next();
    });
  }
};

/** Partition evidence pinned in the active cutover (revision id and hash only, never assignments). */
const cutoverPartitionRevision = async (): Promise<RoutePartitionRevision | undefined> => {
  const comparison = (await readActiveCutover())?.shadowComparison as { partition?: RoutePartitionRevision } | undefined;
  const evidence = comparison?.partition;
  return typeof evidence?.revision === 'string' && typeof evidence.hash === 'string' ? evidence : undefined;
};

let parsedPartition: { raw: string; config: RoutePartitionConfig } | undefined;
/** Trusted server configuration: `LLM_GATEWAY_PARTITION` (JSON revision, hash and assignments). */
const environmentPartition = (): RoutePartitionConfig | undefined => {
  const raw = process.env.LLM_GATEWAY_PARTITION;
  if (!raw) return undefined;
  if (parsedPartition?.raw !== raw) parsedPartition = { raw, config: JSON.parse(raw) as RoutePartitionConfig };
  return parsedPartition.config;
};

const productPartitionSource: RoutePartitionSource = { load: environmentPartition, expected: cutoverPartitionRevision };

// The product accepts session identities only: no service binding, so any service identity is refused.
const productIdentity = (): LlmCallerIdentity => createLlmCallerIdentity({
  directory: createLlmIdentityDirectory(db),
  config: {
    issuer: 'https://sentropic.invalid/product-session', resource: 'https://sentropic.invalid/api/v1/gw',
    source: 'product-api', serviceBindings: [], ownerMapping: [],
  },
});

/** B2 directory resolution of the verified product session; request fields never select anything. */
const resolveProductCaller = (identity: LlmCallerIdentity) => async (context: Context): Promise<CostContext | undefined> => {
  const user = context.get('user') as AuthUser | undefined;
  if (!user?.userId || !user.sessionId) return undefined;
  const principal = await identity.resolveSessionPrincipal({ kind: 'session', userId: user.userId, sessionId: user.sessionId });
  return principal ? {
    tenantId: principal.tenantId, workspaceId: principal.workspaceId, principalId: principal.principalId,
    ownerScopeRef: principal.ownerScopeRef, source: principal.source,
    correlationId: crypto.randomUUID(), callSite: '/api/v1/gw',
  } : undefined;
};

const bounded = async (check: () => Promise<boolean>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check().catch(() => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const refused = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is not available on the product gateway`);
};

type Probed<T> = T & { probe?(): Promise<boolean> };

export interface CreateGwNamespaceModuleOptions {
  readonly nativeMessagesEnabled?: boolean;
  /** Trusted deterministic limits; absent options use the process-owned shared pool. */
  readonly bodyLimit?: RequestBodyLimitOptions;
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  /** Verified caller → directory-resolved cost context; undefined refuses (401), a throw is 503. */
  readonly resolveCaller?: (context: Context) => Promise<CostContext | undefined> | CostContext | undefined;
  readonly routePlane?: ReturnType<typeof createApplicationGatewayRoutePlane>;
  /** One registry per process; tests may pass a qualified registry. */
  readonly modules?: ClusterMeshModules;
  readonly budget?: Probed<BudgetAdmissionPort>;
  readonly settlement?: Probed<RouteMeteringSink>;
  readonly partition?: RoutePartitionSource;
  readonly identityReady?: () => Promise<boolean>;
  readonly defaultOutputTokens?: number;
}

/** Fail closed per namespace when the gateway module cannot be prepared: every `/gw` path is 503. */
const unavailableGwModule = (): ClusterMeshHonoNamespaceModule => ({
  namespace: '/gw',
  enabled: true,
  createRouter() {
    const router = new Hono();
    for (const path of GW_PATHS) router.all(path, (c) => c.json({ error: 'gateway_module_unavailable' }, 503));
    return router;
  },
});

export const createGwNamespaceModule = async (
  options: CreateGwNamespaceModuleOptions = {},
): Promise<ClusterMeshHonoNamespaceModule> => {
  const nativeMessagesEnabled = options.nativeMessagesEnabled ?? gatewayNativeMessagesEnabled(process.env.LLM_GATEWAY_NATIVE_MESSAGES);
  logger.info(gatewayStartupRecord(await resolveGatewayPackageVersion(), nativeMessagesEnabled), 'Gateway native startup');
  const routePlane = options.routePlane ?? createApplicationGatewayRoutePlane({ nativeMessages: nativeMessagesEnabled });
  const identity = options.resolveCaller ? undefined : productIdentity();
  const resolveCaller = options.resolveCaller ?? resolveProductCaller(identity!);
  const ownerRef = `product-api:${control.runtime.generation.generationId}`;
  const budget = options.budget ?? createBudgetAdmission({ database: db, ownerRef });
  const settlement = options.settlement ?? createRouteSettlement({ database: db });
  const partition = createRoutePartition('product', options.partition ?? productPartitionSource);

  // Verified callers handed from the product middleware to the gateway caller-auth port.
  const callers = new Map<string, { readonly cost?: CostContext; readonly failed?: true }>();
  const productCallerAuth: CallerAuthPort = {
    async verify(headers) {
      const token = headers[CALLER_TOKEN_HEADER];
      const entry = token ? callers.get(token) : undefined;
      if (token) callers.delete(token);
      delete (headers as Record<string, string>)[CALLER_TOKEN_HEADER];
      if (entry?.failed) throw new Error('verified caller directory unavailable');
      return entry?.cost ? { ok: true, cost: entry.cost } : { ok: false, reason: 'verified caller unavailable' };
    },
  };
  const config: GatewayConfig = {
    mode: 'personal-passthrough',
    crossUserPoolEnabled: false,
    callerAuth: withSettlementMode(withRoutePartition(productCallerAuth, partition)),
    pool: { listEligibleAccounts: refused('pool'), select: refused('pool'), snapshotModels: refused('pool') },
    authResolver: { resolve: refused('native auth resolver') },
    dispatch: {
      dispatch: refused('native dispatch'),
      dispatchStream: () => { throw new Error('native dispatch is not available on the product gateway'); },
    },
  };
  const probes: Array<() => Promise<boolean>> = [
    async () => Boolean(await readActiveCutover()),
    () => partition.ready(),
    options.identityReady ?? (async () => { await db.execute(sql`SELECT 1`); return true; }),
    async () => ((await routePlane.planner.listModels?.({ principalRef: 'readiness', ownerScopeRef: 'readiness' }))?.length ?? 0) > 0,
    budget.probe ? () => budget.probe!() : async () => false,
    settlement.probe ? () => settlement.probe!() : async () => false,
  ];
  const readiness = { async isReady() { return (await Promise.all(probes.map(bounded))).every(Boolean); } };

  let prepared: ClusterMeshHonoNamespaceModule;
  try {
    prepared = await createGatewayNamespaceModule(options.modules ?? createClusterMeshModules(), {
      enabled: options.enabled ?? true,
      authMode: 'host',
      createRouter: ({ gateway }) => {
        const router = new Hono();
        applyAuthorFence(router);
        router.use('/v1/*', options.authenticate ?? requireAuth);
        router.use('/v1/*', gatewayRequestBodyLimit(options.bodyLimit));
        router.use('/v1/*', settlementModeMiddleware());
        router.use('/v1/*', async (context, next) => {
          const token = crypto.randomUUID();
          try {
            const cost = await resolveCaller(context);
            callers.set(token, cost ? { cost } : {});
          } catch {
            callers.set(token, { failed: true });
          }
          context.req.raw.headers.set(CALLER_TOKEN_HEADER, token);
          try {
            await next();
          } finally {
            callers.delete(token);
          }
        });
        router.route('/', gateway.createGatewayRouter({
          config, readiness, routePlanner: routePlane.planner, routeMetering: settlement,
          nativeMessagesEnabled, nativeCountTokens: routePlane.nativeCountTokens,
          budget: { port: budget, defaultOutputTokens: options.defaultOutputTokens ?? GW_DEFAULT_OUTPUT_TOKENS },
        }));
        return router;
      },
    });
  } catch {
    return unavailableGwModule();
  }
  // The product router uses no invocation context or receipts: keep `createRouter()` callable
  // without the plugin input (route-fence inspection), always delegating to the shared module.
  return {
    ...prepared,
    createRouter: (input) => prepared.createRouter(input ?? ({} as Parameters<typeof prepared.createRouter>[0])),
  };
};

export const productGwModule = await createGwNamespaceModule();
