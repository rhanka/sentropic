import '../modules/topology-guard.js';
import type { VerifiedInvocationContextPort, VerifiedInvocationContext } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { CanonicalHttpPorts, CanonicalRouterOptions } from '@sentropic/comments';
import type { ScopeGrant } from '../storage/authority.js';
import type { createCommentsModule } from '../comments/index.js';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadComments } from '../loaders/comments/index.js';
export interface CommentsRouterInput {
  readonly comments: typeof import('../comments/index.js');
  readonly context: VerifiedInvocationContextPort;
  readonly receipts: InvocationReceiptPort;
}
export interface CommentsNamespaceOptions {
  readonly enabled: boolean;
  readonly createRouter: (input: CommentsRouterInput) => Hono;
}
/** Preflight selected storage/authority composition before the host listens. */
export async function createCommentsNamespaceModule(modules: ClusterMeshModules, options: CommentsNamespaceOptions): Promise<ClusterMeshHonoNamespaceModule> {
  if (!options.enabled) return { namespace: '/comments', enabled: false, createRouter: () => { throw new Error('Cluster Mesh namespace /comments is disabled'); } };
  const comments = await loadComments(modules);
  return { namespace: '/comments', enabled: true, createRouter: ({ context, receipts }) => options.createRouter({ comments, context, receipts }) };
}
export interface CanonicalCommentsNamespaceOptions {
  readonly enabled: boolean; readonly generationId: string;
  readonly module: ReturnType<typeof createCommentsModule>; readonly ports: CanonicalHttpPorts; readonly router: CanonicalRouterOptions;
  /** Host authority derives tenant/workspace from the verified invocation. */
  readonly resolveGrant: (invocation: VerifiedInvocationContext) => Promise<ScopeGrant<unknown>>;
}
export async function createCanonicalCommentsNamespaceModule(modules: ClusterMeshModules, options: CanonicalCommentsNamespaceOptions): Promise<ClusterMeshHonoNamespaceModule> {
  return createCommentsNamespaceModule(modules, { enabled: options.enabled, createRouter: ({ comments, context }) => {
    if (options.ports.store !== options.module.store) throw new Error('Canonical comments namespace requires its own module store');
    const router = new Hono();
    router.use('*', async (http, next) => {
      let invocation: VerifiedInvocationContext;
      try {
        const invocationId = http.req.header('x-invocation-id') ?? randomUUID();
        invocation = await context.verify({ invocationId, correlationId: http.req.header('x-correlation-id') ?? invocationId, generationId: options.generationId,
          method: http.req.method, path: http.req.path, authorizationEvidenceRef: http.req.header('x-cluster-mesh-evidence') });
      } catch { return http.json({ code: 'unauthenticated', message: 'Verified invocation is required' }, 401); }
      let grant: ScopeGrant<unknown>;
      try { grant = await options.resolveGrant(invocation); } catch { return http.json({ code: 'denied', message: 'Comments scope grant is unavailable' }, 403); }
      if (grant.principalId !== invocation.principal.principalId || grant.scope.workspaceId !== invocation.workspace.workspaceId) return http.json({ code: 'denied', message: 'Comments scope grant differs from the verified invocation' }, 403);
      await options.module.withContext(grant, next);
    });
    router.route('/', comments.createCanonicalCommentsRouter(options.ports, options.router)); return router;
  } });
}
