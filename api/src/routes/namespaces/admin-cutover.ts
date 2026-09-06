import { Hono, type MiddlewareHandler } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { ADMIN_ROUTES } from './admin';

export const ADMIN_AUTHOR = 'admin-hono-module';

type AdminRoute = (typeof ADMIN_ROUTES)[number];

export interface AdminCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/admin' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as AdminCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh admin cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureAdminAuthor = async (control: AdminCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/admin' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-admin-v1',
      activeAuthor: ADMIN_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-admin-v1',
        activeAuthor: 'legacy-api-admin-router',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === ADMIN_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyAdminAuthorFence = (
  router: Hono,
  routes: readonly AdminRoute[],
  control?: AdminCutoverControl,
): void => {
  const handler = control ? createAdminAuthorFence(control) : adminAuthorFence;
  for (const [method, path] of routes) {
    router.on(method, path, handler);
  }
};

export const createAdminAuthorFence = (
  control: AdminCutoverControl,
): MiddlewareHandler => async (context, next) => {
  try {
    if (!await ensureAdminAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
    await next();
  } catch {
    return context.json({ error: 'admin_control_unavailable' }, 503);
  }
};

export const adminAuthorFence = createAdminAuthorFence(productControl);
