import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../../services/cluster-mesh-adapter';
import type { DOCUMENT_ROUTES } from './router';

export const DOCUMENT_AUTHOR = 'documents-hono-module';

type DocumentRoute = (typeof DOCUMENT_ROUTES)[number];

export interface DocumentsCutoverControl {
  readonly runtime: { readonly generation: { readonly generationId: string } };
  readonly cutovers: {
    find(key: { compositionRoot: 'product'; namespace: '/documents' }): Promise<{
      status: string;
      activeAuthor: string;
      selectedGenerationId: string;
      shadowComparison?: unknown;
    } | null>;
    activate(record: Record<string, unknown>): Promise<unknown>;
  };
}

const productControl = clusterMeshAdapter.sessionControl as DocumentsCutoverControl | undefined;
if (!productControl) throw new Error('cluster mesh document cutover control is not configured');
let activation: Promise<void> | undefined;

const ensureDocumentAuthor = async (control: DocumentsCutoverControl): Promise<boolean> => {
  const key = { compositionRoot: 'product' as const, namespace: '/documents' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow'
    || (record.status === 'active' && record.shadowComparison !== undefined)) {
    activation ??= control.cutovers.activate({
      ...key,
      selectedGenerationId: control.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-documents-v1',
      activeAuthor: DOCUMENT_AUTHOR,
      status: 'active',
      rollbackCheckpoint: {
        generationId: 'legacy-api-documents-v1',
        activeAuthor: 'legacy-api-document-routers',
      },
      activatedAt: new Date().toISOString(),
    }).then(() => undefined).finally(() => { activation = undefined; });
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === DOCUMENT_AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

export const applyDocumentAuthorFence = (
  router: Hono,
  routes: readonly DocumentRoute[],
  control: DocumentsCutoverControl = productControl,
): void => {
  for (const [method, path] of routes) {
    router.on(method, path, async (context, next) => {
      try {
        if (!await ensureDocumentAuthor(control)) return context.json({ error: 'wrong_author' }, 503);
        await next();
      } catch {
        return context.json({ error: 'document_control_unavailable' }, 503);
      }
    });
  }
};
