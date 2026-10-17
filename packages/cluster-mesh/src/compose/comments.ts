import '../modules/topology-guard.js';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import type { Hono } from 'hono';
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
