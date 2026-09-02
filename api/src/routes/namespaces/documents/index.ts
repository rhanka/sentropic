import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../../middleware/auth';
import {
  applyDocumentAuthorFence,
  type DocumentsCutoverControl,
} from './cutover';
import type { DocumentsNamespacePorts } from './ports';
import { productDocumentsPorts } from './product-ports';
import {
  DOCUMENT_ROUTES,
  createDocumentsTransportRouter,
} from './router';

export { DOCUMENT_AUTHOR } from './cutover';
export type { DocumentsNamespacePorts } from './ports';
export { DOCUMENT_PATHS, DOCUMENT_ROUTES, createDocumentsTransportRouter } from './router';

export interface CreateDocumentsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: DocumentsNamespacePorts;
  readonly cutoverControl?: DocumentsCutoverControl;
}

export const createDocumentsNamespaceModule = (
  options: CreateDocumentsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/documents',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const [method, path] of DOCUMENT_ROUTES) {
      router.on(method, path, options.authenticate ?? requireAuth);
    }
    applyDocumentAuthorFence(router, DOCUMENT_ROUTES, options.cutoverControl);
    router.route('/', createDocumentsTransportRouter(options.ports ?? productDocumentsPorts));
    return router;
  },
});

export const productDocumentsModule = createDocumentsNamespaceModule();
