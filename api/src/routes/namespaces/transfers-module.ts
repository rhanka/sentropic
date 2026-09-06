import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import {
  applyTransferAuthorFence,
  type TransfersCutoverControl,
} from './transfers-cutover';
import { productTransfersPorts } from './transfers-product-ports';
import {
  createTransfersTransportRouter,
  TRANSFER_ROUTES,
  type TransfersNamespacePorts,
} from './transfers';

export {
  createTransfersTransportRouter,
  TRANSFER_PATHS,
  TRANSFER_ROUTES,
  TransferArchiveLimitError,
} from './transfers';
export { TRANSFER_ARCHIVE_LIMITS } from './transfers-product-archive';
export { TRANSFER_AUTHOR } from './transfers-cutover';
export type {
  TransferArchiveHashPort,
  TransferAuthorizationPort,
  TransferDomainPort,
  TransferStoragePort,
  TransfersNamespacePorts,
} from './transfers';

export interface CreateTransfersNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: TransfersNamespacePorts;
  readonly cutoverControl?: TransfersCutoverControl;
}

export const createTransfersNamespaceModule = (
  options: CreateTransfersNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/transfers',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const [method, path] of TRANSFER_ROUTES) {
      router.on(method, path, options.authenticate ?? requireAuth);
    }
    applyTransferAuthorFence(router, TRANSFER_ROUTES, options.cutoverControl);
    router.route('/', createTransfersTransportRouter(options.ports ?? productTransfersPorts));
    return router;
  },
});

export const productTransfersModule = createTransfersNamespaceModule();
