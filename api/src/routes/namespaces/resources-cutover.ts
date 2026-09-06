import { Hono, type MiddlewareHandler } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { RESOURCE_ROUTES } from './resources';

export const RESOURCES_AUTHOR = 'resources-hono-module';
export const RESOURCES_PREDECESSOR = {
  historicalFixture: 'not_applicable',
  replayIdempotencyClaim: false,
  previousGenerationId: 'pre-http-resource-plane-v1',
  rollbackAuthor: 'no-resources-http-author',
} as const;

type ResourcesRoute = (typeof RESOURCE_ROUTES)[number];
export interface ResourcesCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/resources' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as ResourcesCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh resources cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureResourcesAuthor = async (control: ResourcesCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/resources' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: RESOURCES_PREDECESSOR.previousGenerationId,
      activeAuthor: RESOURCES_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: RESOURCES_PREDECESSOR.previousGenerationId,
        activeAuthor: RESOURCES_PREDECESSOR.rollbackAuthor,
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === RESOURCES_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const createResourcesAuthorFence = (
  control: ResourcesCutoverControl,
): MiddlewareHandler => async (context, next) => {
  try {
    if (!await ensureResourcesAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
    await next();
  } catch {
    return context.json({ error: 'resources_control_unavailable' }, 503);
  }
};

export const resourcesAuthorFence = createResourcesAuthorFence(productControl);

export const applyResourcesAuthorFence = (
  router: Hono,
  routes: readonly ResourcesRoute[],
  control?: ResourcesCutoverControl,
): void => {
  const handler = control ? createResourcesAuthorFence(control) : resourcesAuthorFence;
  for (const [method, path] of routes) router.on(method, path, handler);
};
