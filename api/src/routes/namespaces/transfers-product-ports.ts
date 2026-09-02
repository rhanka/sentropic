import { getArtifactStore } from '../../services/artifact-store';
import {
  requireWorkspaceAdmin,
  requireWorkspaceEditor,
} from '../../services/workspace-access';
import type {
  TransferAuthorizationPort,
  TransferStoragePort,
  TransfersNamespacePorts,
} from './transfers';
import { createProductTransferArchivePort } from './transfers-product-archive';
import { productTransferDomainPort } from './transfers-product-domain';

export const productTransferStoragePort: TransferStoragePort = {
  defaultBucket: () => getArtifactStore().defaultBucket(),
  getBytes: (ref) => getArtifactStore().getBytes(ref),
  put: (input) => getArtifactStore().put(input),
};

export const productTransferAuthorizationPort: TransferAuthorizationPort = {
  requireWorkspaceAdmin,
  requireWorkspaceEditor,
};

export const productTransfersPorts: TransfersNamespacePorts = {
  domain: productTransferDomainPort,
  storage: productTransferStoragePort,
  authorization: productTransferAuthorizationPort,
  archive: createProductTransferArchivePort(),
};
