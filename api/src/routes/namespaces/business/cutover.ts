import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../../services/cluster-mesh-adapter';

export const BUSINESS_AUTHOR = 'business-domain-hono-module';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh business cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureBusinessAuthor = async (): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/business' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= (async () => {
      const previousGenerationId = 'legacy-api-business-v1';
      // Historical parity is executed by the immutable test fixture. Runtime records
      // direct single-author activation, not a shadow comparison it did not perform.
      const activationRecord = {
        ...key,
        selectedGenerationId: control.runtime.generation.generationId,
        previousGenerationId,
        activeAuthor: BUSINESS_AUTHOR,
        status: 'active' as const,
        rollbackCheckpoint: {
          generationId: previousGenerationId,
          activeAuthor: 'legacy-api-business-routers',
        },
        activatedAt: new Date().toISOString(),
      };
      await control.cutovers.activate(activationRecord);
    })().finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === BUSINESS_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyBusinessAuthorFence = (router: Hono, paths: readonly string[]): void => {
  for (const path of paths) {
    router.use(path, async (context, next) => {
      try {
        if (!await ensureBusinessAuthor()) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'business_control_unavailable' }, 503);
      }
    });
  }
};
