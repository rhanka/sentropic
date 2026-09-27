/**
 * Standalone gateway host composition (spec D1-D3, B1). One cluster-mesh module
 * registry, one gateway namespace module mounted at `/`, and the gateway router
 * built exactly once by the cluster plugin. Importing this module never listens,
 * migrates or reads the environment; `index.ts` owns the process.
 */
import { Hono } from 'hono';
import {
  createClusterMeshModules,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  type ClusterMeshModules,
} from '@sentropic/cluster-mesh';
import { createGatewayNamespaceModule } from '@sentropic/cluster-mesh/compose/gateway';
import type {
  BudgetAdmissionPort, CallerAuthPort, CreateGatewayRouterOptions, GatewayConfig, RouteMeteringSink,
} from '@sentropic/llm-gateway';
import type { RoutePlanner } from '@sentropic/llm-mesh';

import {
  createGatewayRoutePlane,
  type GatewayRoutePlanePorts,
} from '../../../api/src/services/llm-runtime/standalone-ports';
// Direct module imports: the llm-metering barrel also exports the observe-only sink, whose
// database client reads the environment on import; the host injects its database instead.
import {
  createBudgetAdmission, createRoutePartition, withCatalogQuote, withRoutePartition, type LedgerDatabase,
  type RoutePartitionSource,
} from '../../../api/src/services/llm-metering/budget-admission';
import {
  createRouteSettlement, settlementModeMiddleware, withSettlementMode,
} from '../../../api/src/services/llm-metering/route-settlement';
import type { HostConfig } from './config';
import { runReservationReaperSweep, type ReapResult } from '../../../api/src/services/llm-metering/reservation-reaper';
import {
  createHostReadiness, storeProbe, type DependencyProbe, type HostReadiness, type ProbeFailure,
} from './readiness';

type Gateway = typeof import('@sentropic/llm-gateway');
type Probe = (signal: AbortSignal) => Promise<boolean>;

/** B2: verified caller identity and workspace directory. */
export interface IdentityDependency { readonly callerAuth: CallerAuthPort; readonly ready: Probe }
/** B4: owner-scoped route planning over the mesh account store / seat projection. */
export interface RoutingDependency {
  readonly planner: RoutePlanner;
  readonly routeInput?: CreateGatewayRouterOptions['routeInput'];
  readonly ready: Probe;
}
/** B3c: one aggregate settlement per request into the ledger (never `recordLlmUsage`). */
export interface SettlementDependency { readonly metering: RouteMeteringSink; readonly ready: Probe }
/** B3c: budget admission (reserve, dispatch marker, release) over the ledger store. */
export interface BudgetDependency {
  readonly port: BudgetAdmissionPort;
  readonly ready: Probe;
  /** Output ceiling reserved for a request without max tokens; absent refuses such requests (400). */
  readonly defaultOutputTokens?: number;
}
/** B3c: D2 partition; the trusted configuration revision is verified before every admission. */
export interface PartitionDependency { readonly source: RoutePartitionSource }

export interface HostDependencies {
  readonly reaper?: (limit: number) => Promise<ReapResult>;
  readonly identity?: IdentityDependency;
  readonly routing?: RoutingDependency;
  readonly budget?: BudgetDependency;
  readonly settlement?: SettlementDependency;
  readonly partition?: PartitionDependency;
}

export class HostCompositionError extends Error {
  readonly code = 'invalid_llm_gateway_host_composition';

  constructor(message: string) {
    super(message);
    this.name = 'HostCompositionError';
  }
}

export interface HostApp {
  readonly reaper?: (limit: number) => Promise<ReapResult>;
  readonly app: Hono;
  readonly readiness: HostReadiness;
  /** Stops new admission: every `/v1/*` request then gets the frozen provider-shaped 503. */
  closeAdmission(): void;
  /** Dependency slots still pending (B2-B4); non-empty means never ready. */
  readonly pending: readonly string[];
}

export interface CreateHostAppOptions {
  readonly config: HostConfig;
  readonly dependencies: HostDependencies;
  /** Test/qualification seam; production creates exactly one registry here. */
  readonly modules?: ClusterMeshModules;
  readonly onProbeFailure?: (name: string, failure: ProbeFailure) => void;
}

/**
 * Builds the B4 routing slot on the extracted route plane with injected real ports; its planner
 * carries the catalog quote seam required by budget admission.
 */
export const createRoutingDependency = (
  ports: Omit<GatewayRoutePlanePorts, 'name'> & { readonly ready: Probe },
): RoutingDependency => ({
  planner: withCatalogQuote(createGatewayRoutePlane({ ...ports, name: 'standalone' }).planner, {
    catalog: ports.catalog, councilRevision: ports.councilRevision,
  }),
  ready: ports.ready,
});

/**
 * B3c: the same application budget admission and route settlement adapters as the product
 * `/gw`, over an injected ledger database (the host never migrates and holds no fallback store).
 */
export const createLedgerDependencies = (options: {
  readonly database: LedgerDatabase;
  readonly ownerRef: string;
  readonly defaultOutputTokens?: number;
  readonly now?: () => Date;
}): { readonly budget: BudgetDependency; readonly settlement: SettlementDependency; readonly reaper: (limit: number) => Promise<ReapResult> } => {
  const port = createBudgetAdmission({
    database: options.database, ownerRef: options.ownerRef, ...(options.now ? { now: options.now } : {}),
  });
  const metering = createRouteSettlement({ database: options.database, ...(options.now ? { now: options.now } : {}) });
  return {
    budget: {
      port, ready: storeProbe(() => port.probe()),
      ...(options.defaultOutputTokens !== undefined ? { defaultOutputTokens: options.defaultOutputTokens } : {}),
    },
    settlement: { metering, ready: storeProbe(() => metering.probe()) },
    reaper: (limit) => runReservationReaperSweep({ database: options.database, limit }),
  };
};

const refused = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is not available in the standalone gateway host`);
};

const requireMethods = (slot: string, value: unknown, methods: readonly string[]): void => {
  if (!value || typeof value !== 'object') throw new HostCompositionError(`${slot} port is missing`);
  for (const method of methods) {
    if (typeof (value as Record<string, unknown>)[method] !== 'function') {
      throw new HostCompositionError(`${slot} port lacks ${method}()`);
    }
  }
};

const validateDependencies = (gateway: Gateway, dependencies: HostDependencies): void => {
  const { identity, routing, budget, settlement, partition } = dependencies;
  if (identity) {
    requireMethods('identity', identity, ['ready']);
    requireMethods('identity.callerAuth', identity.callerAuth, ['verify']);
    if (identity.callerAuth === gateway.stubCallerAuth) {
      throw new HostCompositionError('identity.callerAuth must not be the gateway scaffold stub');
    }
  }
  if (routing) {
    requireMethods('routing', routing, ['ready']);
    requireMethods('routing.planner', routing.planner, ['plan', 'prepareAttempt', 'quote']);
  }
  if (budget) {
    requireMethods('budget', budget, ['ready']);
    requireMethods('budget.port', budget.port, ['admit', 'markDispatched', 'release']);
  }
  if (settlement) {
    requireMethods('settlement', settlement, ['ready']);
    requireMethods('settlement.metering', settlement.metering, ['settleRoute']);
  }
  if (partition) requireMethods('partition.source', partition.source, ['load', 'expected']);
};

const SLOTS = ['identity', 'routing', 'budget', 'settlement', 'partition'] as const;

export const createHostApp = async (options: CreateHostAppOptions): Promise<HostApp> => {
  const { dependencies } = options;
  const pending = SLOTS.filter((slot) => !dependencies[slot]);
  const partition = dependencies.partition ? createRoutePartition('standalone', dependencies.partition.source) : undefined;
  const probes: DependencyProbe[] = SLOTS.map((slot) => ({
    name: slot,
    check: slot === 'partition'
      ? (partition ? storeProbe(() => partition.ready()) : async () => false)
      : dependencies[slot]?.ready ?? (async () => false),
  }));
  const readiness = createHostReadiness({
    probes, ...(options.onProbeFailure ? { onProbeFailure: options.onProbeFailure } : {}),
  });
  let admissionOpen = true;

  // Admission gate at caller verification: any throw maps to the frozen 503. A verified identity
  // assigned to the product (or to no host) is refused (401) before any account or budget effect.
  const verified: CallerAuthPort = {
    async verify(headers, context) {
      if (!admissionOpen) throw new Error('admission closed');
      if (pending.length > 0 || !dependencies.identity) throw new Error('dependencies pending');
      return dependencies.identity.callerAuth.verify(headers, context);
    },
  };
  const callerAuth = withSettlementMode(partition ? withRoutePartition(verified, partition) : verified);
  const config: GatewayConfig = {
    mode: 'personal-passthrough',
    crossUserPoolEnabled: false,
    callerAuth,
    pool: {
      listEligibleAccounts: refused('pool'), select: refused('pool'), snapshotModels: refused('pool'),
    },
    authResolver: { resolve: refused('native auth resolver') },
    dispatch: {
      dispatch: refused('native dispatch'),
      dispatchStream: () => { throw new Error('native dispatch is not available in the standalone gateway host'); },
    },
  };
  const routePlanner: RoutePlanner = dependencies.routing?.planner ?? {
    plan: refused('route planning'), prepareAttempt: refused('route planning'),
    quote: () => { throw new Error('route planning is not available in the standalone gateway host'); },
    describeAffinity: () => null, resetAffinity: () => false,
    promoteAffinity: () => { throw new Error('route planning is not available in the standalone gateway host'); },
    rebindAffinity: () => { throw new Error('route planning is not available in the standalone gateway host'); },
  };
  const routeMetering: RouteMeteringSink = dependencies.settlement?.metering ?? { settleRoute: refused('settlement') };
  const budgetPort: BudgetAdmissionPort = dependencies.budget?.port ?? {
    admit: async () => ({ kind: 'unavailable' }), markDispatched: refused('budget'), release: refused('budget'),
  };
  const defaultOutputTokens = dependencies.budget?.defaultOutputTokens;

  const modules = options.modules ?? createClusterMeshModules();
  const namespace = await createGatewayNamespaceModule(modules, {
    enabled: true,
    authMode: 'host',
    createRouter: ({ gateway }) => {
      validateDependencies(gateway, dependencies);
      const routeInput = dependencies.routing?.routeInput;
      const router = new Hono();
      router.use('/v1/*', settlementModeMiddleware());
      router.route('/', gateway.createGatewayRouter({
        config, readiness, routePlanner, routeMetering, ...(routeInput ? { routeInput } : {}),
        // Budget admission is never optional here: every admitted request reserves before dispatch.
        budget: { port: budgetPort, ...(defaultOutputTokens !== undefined ? { defaultOutputTokens } : {}) },
      }));
      return router;
    },
  });
  const runtime = createClusterMeshRuntime({
    generationId: 'llm-gateway-host',
    config: { capacity: { poolSize: 1 } },
    // No remote control plane: cluster invocation contexts and receipts are refused.
    context: { verify: refused('cluster invocation context') },
    registration: { authorize: refused('cluster registration') },
    receipts: { append: refused('cluster invocation receipt') },
  });
  const app = createClusterMeshPlugin({ runtime, namespaces: [namespace], mounts: { '/gw': '/' } });
  return {
    app,
    readiness,
    pending,
    ...(dependencies.reaper ? { reaper: dependencies.reaper } : {}),
    closeAdmission() { admissionOpen = false; },
  };
};
