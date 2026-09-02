import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  comments,
  contextDocuments,
  folders,
  initiatives,
  organizations,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
import { LocalFsArtifactStore } from '../../src/services/artifact-store/local-fs-artifact-store';
import {
  getArtifactStore,
  setArtifactStoreForTesting,
} from '../../src/services/artifact-store';
import type { TransfersCutoverControl } from '../../src/routes/namespaces/transfers-cutover';
import {
  createTransfersNamespaceModule,
  TRANSFER_ARCHIVE_LIMITS,
  TRANSFER_AUTHOR,
  TRANSFER_PATHS,
  TRANSFER_ROUTES,
  createTransfersTransportRouter,
  type TransfersNamespacePorts,
} from '../../src/routes/namespaces/transfers-module';
import { productTransfersPorts } from '../../src/routes/namespaces/transfers-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  exportsRouter as legacyExportsRouter,
  importsRouter as legacyImportsRouter,
} from '../fixtures/historical/transfers-be37d69f6/api/src/routes/api/import-export';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/transfers' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: TransfersNamespacePorts = productTransfersPorts,
  cutoverControl?: TransfersCutoverControl,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createTransfersNamespaceModule({ enabled, ports, cutoverControl })],
  mounts: { '/transfers': '/' },
}));
const historical = new Hono()
  .use('/api/v1/exports/*', requireAuth)
  .route('/api/v1/exports', legacyExportsRouter)
  .use('/api/v1/imports/*', requireAuth)
  .route('/api/v1/imports', legacyImportsRouter);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(
    (name) => `${JSON.stringify(name)}:${stableStringify(object[name])}`,
  ).join(',')}}`;
};
const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(stableStringify(value));
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const buildArchive = async (
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  manifestOverrides: Record<string, unknown> = {},
): Promise<Uint8Array> => {
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.bytes, { createFolders: false });
  const manifestCore = {
    export_version: '1.0',
    schema_version: 'test',
    created_at: '2026-09-02T00:00:00.000Z',
    scope: 'workspace',
    scope_id: null,
    include_comments: false,
    include_documents: false,
    files: files.map((file) => ({
      path: file.path,
      bytes: file.bytes.byteLength,
      sha256: sha256(file.bytes),
    })),
    ...manifestOverrides,
  };
  zip.file('manifest.json', encodeJson({
    ...manifestCore,
    manifest_hash: sha256(encodeJson(manifestCore)),
  }), { createFolders: false });
  return zip.generateAsync({ type: 'uint8array' });
};
