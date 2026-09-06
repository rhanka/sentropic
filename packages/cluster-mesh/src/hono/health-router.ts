import type { ClusterMeshNamespace } from '@sentropic/contracts';
import { Hono, type MiddlewareHandler } from 'hono';

import type { ClusterMeshHonoNamespaceModule } from './plugin.js';

export const HEALTH_ROUTES = [['GET', '/health']] as const;
export const HEALTH_PATHS = ['/health'] as const;

export type HealthProbeStatus = 'ok' | 'degraded' | 'unavailable';
export type HealthServiceValue =
  | string
  | number
  | boolean
  | null
  | readonly HealthServiceValue[]
  | { readonly [key: string]: HealthServiceValue };

export interface HealthProbeResult {
  readonly status: HealthProbeStatus;
  readonly reason?: string;
  readonly services?: Readonly<Record<string, HealthServiceValue>>;
}

export interface HealthProbePort {
  readonly name: string;
  check(): Promise<HealthProbeResult>;
}

export interface HealthStatePort {
  snapshot(): {
    readonly generation: { readonly generationId: string; readonly status: string };
    readonly modules: readonly {
      readonly namespace: ClusterMeshNamespace;
      readonly enabled: boolean;
    }[];
  };
}

export interface HealthRouterOptions {
  readonly probes: readonly HealthProbePort[];
  readonly state: HealthStatePort;
  readonly beforeProbe?: MiddlewareHandler;
  readonly now?: () => Date;
}

const runProbe = async (probe: HealthProbePort): Promise<HealthProbeResult> => {
  try {
    return await probe.check();
  } catch {
    return { status: 'unavailable', reason: `${probe.name}_probe_failed` };
  }
};

export const createHealthRouter = (options: HealthRouterOptions): Hono => {
  if (!options.probes.length || !options.state?.snapshot) {
    throw new Error('health probes and state are unavailable');
  }
  const router = new Hono();
  if (options.beforeProbe) router.get('/health', options.beforeProbe);
  router.get('/health', async (context) => {
    const results = await Promise.all(options.probes.map(async (probe) => ({
      name: probe.name,
      result: await runProbe(probe),
    })));
    const reasons = results
      .filter(({ result }) => result.status !== 'ok')
      .map(({ name, result }) => result.reason ?? `${name}_${result.status}`);
    const readiness = results.some(({ result }) => result.status === 'unavailable')
      ? 'unavailable'
      : results.some(({ result }) => result.status === 'degraded') ? 'degraded' : 'ready';
    const services = Object.assign({}, ...results.map(({ result }) => result.services ?? {}));
    return context.json({
      status: readiness === 'unavailable' ? 'error' : 'ok',
      timestamp: (options.now ?? (() => new Date()))().toISOString(),
      services,
      clusterMesh: options.state.snapshot(),
      readiness: { status: readiness, reasons },
    }, readiness === 'unavailable' ? 503 : 200);
  });
  return router;
};

export const createHealthNamespaceModule = (
  options: HealthRouterOptions & { readonly enabled?: boolean },
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/health',
  enabled: options.enabled ?? true,
  createRouter: () => createHealthRouter(options),
});
