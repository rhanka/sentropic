import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createGatewayRouter,
  stubGatewayConfig,
  type CostContext,
} from '../../../../packages/llm-gateway/src/index';
import { Hono, type Context, type MiddlewareHandler } from 'hono';

import { requireAuth, type AuthUser } from '../../middleware/auth';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { createApplicationGatewayRoutePlane } from '../../services/llm-runtime/gateway-route-plane';
import { resolveTenantAuthoritatively } from '../../services/tenancy/resolve-tenant';

export const GW_AUTHOR = 'llm-gateway-module';
export const GW_PATHS = [
  '/healthz', '/readyz', '/v1/*', '/v1/models', '/v1/messages', '/v1/chat/completions',
] as const;
const CALLER_TOKEN_HEADER = 'x-sentropic-internal-gateway-caller';
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
  readonly resolveCallerOwnership?: (context: Context) => Promise<CostContext> | CostContext;
  readonly routePlane?: ReturnType<typeof createApplicationGatewayRoutePlane>;
}

export const createGwNamespaceModule = (
  options: CreateGwNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => {
  const routePlane = options.routePlane ?? createApplicationGatewayRoutePlane();
  const resolveCallerOwnership = options.resolveCallerOwnership ?? resolveProductCaller;
  const callers = new Map<string, CostContext>();
  const config = {
    ...stubGatewayConfig,
    callerAuth: {
      async verify(headers: Readonly<Record<string, string>>) {
        const token = headers[CALLER_TOKEN_HEADER];
        const cost = token ? callers.get(token) : undefined;
        if (token) callers.delete(token);
        delete (headers as Record<string, string>)[CALLER_TOKEN_HEADER];
        return cost ? { ok: true, cost } : { ok: false, reason: 'verified caller unavailable' };
      },
    },
  };
  return {
    namespace: '/gw',
    enabled: options.enabled ?? true,
    createRouter() {
      const router = new Hono();
      applyAuthorFence(router);
      router.use('/v1/*', options.authenticate ?? requireAuth);
      router.use('/v1/*', async (context, next) => {
        const token = crypto.randomUUID();
        try {
          callers.set(token, await resolveCallerOwnership(context));
        } catch {
          // The gateway's caller-auth port maps a missing trusted projection to its frozen 401 shape.
        }
        context.req.raw.headers.set(CALLER_TOKEN_HEADER, token);
        try {
          await next();
        } finally {
          callers.delete(token);
        }
      });
      router.route('/', createGatewayRouter({
        config,
        routePlanner: routePlane.planner,
        routeMetering: { settleRoute() {} },
      }));
      return router;
    },
  };
};

export const productGwModule = createGwNamespaceModule();
