import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import type { TRANSFER_ROUTES } from './transfers';

export const TRANSFER_AUTHOR = 'transfers-hono-module';

type TransferRoute = (typeof TRANSFER_ROUTES)[number];

export interface TransfersCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/transfers' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as TransfersCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh transfer cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureTransferAuthor = async (control: TransfersCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/transfers' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-transfers-v1',
      activeAuthor: TRANSFER_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-transfers-v1',
        activeAuthor: 'legacy-api-import-export-router',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === TRANSFER_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyTransferAuthorFence = (
  router: Hono,
  routes: readonly TransferRoute[],
  control: TransfersCutoverControl = productControl,
): void => {
  for (const [method, path] of routes) {
    router.on(method, path, async (context, next) => {
      try {
        if (!await ensureTransferAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'transfer_control_unavailable' }, 503);
      }
    });
  }
};
