import type {
  ClusterMeshHonoNamespaceModule,
  GraphifyMemoryShadowAdapter,
  GraphifyMemoryShadowResult,
} from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';

export const MEMORY_PATHS = ['/query-intents'] as const;

export interface CreateMemoryNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly adapter?: GraphifyMemoryShadowAdapter;
  readonly generationId?: string;
}

const responseStatus = (result: Exclude<GraphifyMemoryShadowResult, { ok: true }>): 400 | 403 | 409 | 503 => {
  if (result.reason === 'memory_query_intent_invalid') return 400;
  if (result.reason === 'memory_authorization_unavailable') return 403;
  if (result.reason === 'memory_query_ineligible'
    || result.reason === 'memory_final_revalidation_refused') return 409;
  return 503;
};

export const createMemoryNamespaceModule = (
  options: CreateMemoryNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/memory',
  enabled: options.enabled ?? false,
  createRouter(ports) {
    const router = new Hono();
    for (const path of MEMORY_PATHS) {
      router.use(path, async (context, next) => {
        const availability = options.adapter?.availability() ?? 'memory_provider_unavailable';
        if (availability !== 'available') return context.json({ error: availability }, 503);
        return next();
      });
      router.use(path, options.authenticate ?? requireAuth);
    }

    router.post('/query-intents', async (context) => {
      const invocationId = context.req.header('x-cluster-mesh-invocation-id');
      if (!invocationId) return context.json({ error: 'memory_invocation_reference_required' }, 400);
      if (!options.generationId) return context.json({ error: 'memory_runtime_unavailable' }, 503);
      let verified;
      try {
        verified = await ports.context.verify({
          invocationId,
          correlationId: context.req.header('x-correlation-id') ?? invocationId,
          generationId: options.generationId,
          method: context.req.method,
          path: context.req.path,
          authorizationEvidenceRef: context.req.header('x-cluster-mesh-evidence'),
        });
      } catch {
        return context.json({ error: 'memory_invocation_unverified' }, 401);
      }
      const queryIntent = await context.req.json().catch(() => undefined);
      const result = await options.adapter!.shadowQuery({ context: verified, queryIntent });
      if (!result.ok) {
        return context.json({
          error: result.reason,
          ...(result.refusalRef ? { refusalRef: result.refusalRef } : {}),
        }, responseStatus(result));
      }
      return context.json({ cursorRef: result.cursorRef, receiptRef: result.receiptRef });
    });
    return router;
  },
});

// Product exposure is a truthful 503 shell until all Graphify evidence is pinned and injected.
export const productMemoryModule = createMemoryNamespaceModule({ enabled: true });
