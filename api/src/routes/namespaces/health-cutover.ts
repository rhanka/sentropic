import type { MiddlewareHandler } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

export const HEALTH_AUTHOR = 'health-hono-module';

export interface HealthCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/health' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as HealthCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh health cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureHealthAuthor = async (control: HealthCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/health' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-health-v1',
      activeAuthor: HEALTH_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-health-v1',
        activeAuthor: 'legacy-api-health-router',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === HEALTH_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const createHealthAuthorFence = (
  control: HealthCutoverControl,
): MiddlewareHandler => async (context, next) => {
  try {
    if (!await ensureHealthAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
    await next();
  } catch {
    return context.json({ error: 'health_control_unavailable' }, 503);
  }
};

export const healthAuthorFence = createHealthAuthorFence(productControl);
