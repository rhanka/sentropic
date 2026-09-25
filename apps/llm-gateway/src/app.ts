/**
 * Standalone gateway host composition (spec D1-D3, B1). One cluster-mesh module
 * registry, one gateway namespace module mounted at `/`, and the gateway router
 * built exactly once by the cluster plugin. Importing this module never listens,
 * migrates or reads the environment; `index.ts` owns the process.
 */
import type { Hono } from 'hono';
import {
  createClusterMeshModules,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  type ClusterMeshModules,
} from '@sentropic/cluster-mesh';
import { createGatewayNamespaceModule } from '@sentropic/cluster-mesh/compose/gateway';
import type { CallerAuthPort, CreateGatewayRouterOptions, GatewayConfig, RouteMeteringSink } from '@sentropic/llm-gateway';
import type { RoutePlanner } from '@sentropic/llm-mesh';

import {
  createGatewayRoutePlane,
  type GatewayRoutePlanePorts,
} from '../../../api/src/services/llm-runtime/standalone-ports';
import type { HostConfig } from './config';
import { createHostReadiness, type DependencyProbe, type HostReadiness, type ProbeFailure } from './readiness';

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
/** B3c: one aggregate settlement per request into the ledger. */
export interface SettlementDependency { readonly metering: RouteMeteringSink; readonly ready: Probe }

export interface HostDependencies {
  readonly identity?: IdentityDependency;
  readonly routing?: RoutingDependency;
  readonly settlement?: SettlementDependency;
}

export class HostCompositionError extends Error {
  readonly code = 'invalid_llm_gateway_host_composition';

  constructor(message: string) {
    super(message);
    this.name = 'HostCompositionError';
  }
}

export interface HostApp {
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

/** Builds the B4 routing slot on the extracted route plane with injected real ports. */
export const createRoutingDependency = (
  ports: Omit<GatewayRoutePlanePorts, 'name'> & { readonly ready: Probe },
): RoutingDependency => ({
  planner: createGatewayRoutePlane({ ...ports, name: 'standalone' }).planner,
  ready: ports.ready,
});

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
  const { identity, routing, settlement } = dependencies;
  if (identity) {
    requireMethods('identity', identity, ['ready']);
    requireMethods('identity.callerAuth', identity.callerAuth, ['verify']);
    if (identity.callerAuth === gateway.stubCallerAuth) {
      throw new HostCompositionError('identity.callerAuth must not be the gateway scaffold stub');
    }
  }
  if (routing) {
    requireMethods('routing', routing, ['ready']);
    requireMethods('routing.planner', routing.planner, ['plan', 'prepareAttempt']);
  }
  if (settlement) {
    requireMethods('settlement', settlement, ['ready']);
    requireMethods('settlement.metering', settlement.metering, ['settleRoute']);
  }
};

const SLOTS = ['identity', 'routing', 'settlement'] as const;

export const createHostApp = async (options: CreateHostAppOptions): Promise<HostApp> => {
  const { dependencies } = options;
  const pending = SLOTS.filter((slot) => !dependencies[slot]);
  const probes: DependencyProbe[] = SLOTS.map((slot) => ({
    name: slot,
    check: dependencies[slot]?.ready ?? (async () => false),
  }));
  const readiness = createHostReadiness({
    probes, ...(options.onProbeFailure ? { onProbeFailure: options.onProbeFailure } : {}),
  });
  let admissionOpen = true;

  // Admission gate at caller verification: any throw maps to the frozen 503.
  const callerAuth: CallerAuthPort = {
    async verify(headers, context) {
      if (!admissionOpen) throw new Error('admission closed');
      if (pending.length > 0 || !dependencies.identity) throw new Error('dependencies pending');
      return dependencies.identity.callerAuth.verify(headers, context);
    },
  };
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
    describeAffinity: () => null, resetAffinity: () => false,
    promoteAffinity: () => { throw new Error('route planning is not available in the standalone gateway host'); },
    rebindAffinity: () => { throw new Error('route planning is not available in the standalone gateway host'); },
  };
  const routeMetering: RouteMeteringSink = dependencies.settlement?.metering ?? { settleRoute: refused('settlement') };

  const modules = options.modules ?? createClusterMeshModules();
  const namespace = await createGatewayNamespaceModule(modules, {
    enabled: true,
    authMode: 'host',
    createRouter: ({ gateway }) => {
      validateDependencies(gateway, dependencies);
      const routeInput = dependencies.routing?.routeInput;
      return gateway.createGatewayRouter({
        config, readiness, routePlanner, routeMetering, ...(routeInput ? { routeInput } : {}),
      });
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
    closeAdmission() { admissionOpen = false; },
  };
};
