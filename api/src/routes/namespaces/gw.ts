import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createGatewayRouter,
  stubGatewayConfig,
  type CostContext,
  type CreateGatewayRouterOptions,
} from '../../../../packages/llm-gateway/src/index';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth, type AuthUser } from '../../middleware/auth';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { createApplicationGatewayRoutePlane } from '../../services/llm-runtime/gateway-route-plane';
import { resolveTenantAuthoritatively } from '../../services/tenancy/resolve-tenant';

export const GW_AUTHOR = 'llm-gateway-module';
export const GW_PATHS = [
  '/healthz', '/readyz', '/v1/*', '/v1/models', '/v1/messages', '/v1/chat/completions',
] as const;
const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh gateway cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/gw' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    activation ??= (async () => {
      const previousGenerationId = 'application-llm-adapter-v1';
      const shadow = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: GW_AUTHOR,
        status: 'shadow' as const,
        shadowComparison: {
          strategy: 'deterministic-ingress-route-intent',
          normalizationRef: 'packages/llm-gateway/tests/canonical-ingress.test.ts',
          routeIntentRef: 'api/tests/unit/provider-mesh-contract-proof.test.ts',
          effectsDuplicated: false,
        },
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'application-llm-adapter',
        },
      };
      await control.cutovers.activate(shadow);
      await control.cutovers.activate({
        ...shadow,
        status: 'active',
        activatedAt: new Date().toISOString(),
      });
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === GW_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

const applyAuthorFence = (router: Hono): void => {
  for (const path of GW_PATHS) {
    router.use(path, async (c, next) => {
      try {
        if (!await ensureAuthor()) return c.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return c.json({ error: 'gateway_control_unavailable' }, 503);
      }
    });
  }
};

const resolveProductCaller = async (context: import('hono').Context): Promise<CostContext> => {
  const user = context.get('user') as AuthUser | undefined;
  if (!user?.userId || !user.workspaceId) throw new Error('verified product caller is required');
  const tenant = await resolveTenantAuthoritatively({
    workspaceId: user.workspaceId,
    userId: user.userId,
  });
  if ('error' in tenant) throw new Error('caller tenant is unresolved');
  return {
    tenantId: tenant.tenantId,
    workspaceId: user.workspaceId,
    principalId: user.userId,
    ownerScopeRef: `workspace:${user.workspaceId}:principal:${user.userId}`,
    source: 'product-api',
    correlationId: context.req.header('x-sentropic-request-id') ?? crypto.randomUUID(),
    callSite: '/api/v1/gw',
  };
};

export interface CreateGwNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly resolveCallerOwnership?: CreateGatewayRouterOptions['resolveCallerOwnership'];
  readonly routePlane?: ReturnType<typeof createApplicationGatewayRoutePlane>;
}

export const createGwNamespaceModule = (
  options: CreateGwNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => {
  const routePlane = options.routePlane ?? createApplicationGatewayRoutePlane();
  return {
    namespace: '/gw',
    enabled: options.enabled ?? true,
    createRouter() {
      const router = new Hono();
      applyAuthorFence(router);
      router.use('/v1/*', options.authenticate ?? requireAuth);
      router.route('/', createGatewayRouter({
        config: stubGatewayConfig,
        routePlanner: routePlane.planner,
        shadowRouteIntent: routePlane.shadowRouteIntent,
        routeMetering: { settleRoute() {} },
        resolveCallerOwnership: options.resolveCallerOwnership ?? resolveProductCaller,
      }));
      return router;
    },
  };
};

export const productGwModule = createGwNamespaceModule();
