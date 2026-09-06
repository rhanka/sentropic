import { Hono, type MiddlewareHandler } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { CATALOG_ROUTES } from './catalog';

export const CATALOG_AUTHOR = 'catalog-hono-module';
export const CATALOG_PREDECESSOR = {
  historicalFixture: 'not_applicable',
  replayIdempotencyClaim: false,
  previousGenerationId: 'pre-http-catalog-service-v1',
  rollbackAuthor: 'no-catalog-http-author',
} as const;

type CatalogRoute = (typeof CATALOG_ROUTES)[number];

export interface CatalogCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/catalog' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as CatalogCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh catalog cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureCatalogAuthor = async (control: CatalogCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/catalog' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: CATALOG_PREDECESSOR.previousGenerationId,
      activeAuthor: CATALOG_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: CATALOG_PREDECESSOR.previousGenerationId,
        activeAuthor: CATALOG_PREDECESSOR.rollbackAuthor,
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === CATALOG_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const createCatalogAuthorFence = (
  control: CatalogCutoverControl,
): MiddlewareHandler => async (context, next) => {
  try {
    if (!await ensureCatalogAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
    await next();
  } catch {
    return context.json({ error: 'catalog_control_unavailable' }, 503);
  }
};

export const catalogAuthorFence = createCatalogAuthorFence(productControl);

export const applyCatalogAuthorFence = (
  router: Hono,
  routes: readonly CatalogRoute[],
  control?: CatalogCutoverControl,
): void => {
  const handler = control ? createCatalogAuthorFence(control) : catalogAuthorFence;
  for (const [method, path] of routes) router.on(method, path, handler);
};
