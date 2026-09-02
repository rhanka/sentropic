import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ deleteObject: vi.fn() }));
vi.mock('../../src/services/storage-s3', () => ({
  deleteObject: storage.deleteObject,
  getDocumentsBucketName: () => 'cutover-fixture',
  getObjectBodyStream: async () => new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([25, 8, 79]));
      controller.close();
    },
  }),
  getObjectBytes: async () => new Uint8Array([25, 8, 79]),
  putObject: vi.fn(),
}));

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { contextDocuments, contextModificationHistory, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import type { DocumentsCutoverControl } from '../../src/routes/namespaces/documents/cutover';
import {
  createDocumentsNamespaceModule,
  type DocumentsNamespacePorts,
} from '../../src/routes/namespaces/documents';
import { productDocumentsPorts } from '../../src/routes/namespaces/documents/product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { documentsRouter as legacyDocumentsRouter } from '../fixtures/historical/documents-8799412e0/api/src/routes/api/documents';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/documents' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: DocumentsNamespacePorts = productDocumentsPorts,
  cutoverControl?: DocumentsCutoverControl,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createDocumentsNamespaceModule({ enabled, ports, cutoverControl })],
  mounts: { '/documents': '/' },
}));
const historical = new Hono()
  .use('/api/v1/documents/*', requireAuth)
  .route('/api/v1/documents', legacyDocumentsRouter);

const bridges = [
  ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
  ['db/schema.ts', 'ba54b123146a3f213c12afc7a44a92c629ce3c77558b41b713fd61029775cd3d'],
  ['middleware/workspace-rbac.ts', 'a2062bf47156a5aafe9c56160667c64a4443e8c6486c297c5aad7d0063b34610'],
  ['services/context-document-source.ts', 'd00e8ffdc82680af1a2de51e2ac74102bf22d6c99b9e1b1c2993f9c03fc08f62'],
  ['services/google-drive-client.ts', 'a6529d3da492b2251396cea16607d34bab51e87980081049e767a5df4b4dda35'],
  ['services/google-drive-connector-accounts.ts', '438b015569cea181d364247a37b61bd49c06f9ea6d4e74183e64f2023fd0605f'],
  ['services/queue-manager.ts', 'e6734b93da7a7c765dd135ff2b18e25a734ecc9b5ac78068b1a1028ea69a5b25'],
  ['services/storage-s3.ts', '3a867eb71bf3ba9941524ab14341bf9448aeadb7b48f8df3e8a13a7f5e3af026'],
  ['services/workspace-access.ts', '89e13a21f2b309d14f36231bfd25170e32cec1385f48e1ef40dd5875769ed9f6'],
  ['utils/id.ts', '7148d17b36975340ed8d20ae49c96a1b06f7d107b9b2492e32e15fe169a24aa3'],
] as const;

const documentRow = (id: string, workspaceId: string, contextId: string) => ({
  id,
  workspaceId,
  contextType: 'folder',
  contextId,
  filename: `${contextId}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 3,
  sourceType: 'local',
  storageKey: null,
  status: 'ready',
  data: { summary: 'Twin summary', summaryLang: 'en' },
  version: 1,
});

describe('cluster mesh documents cutover', () => {
  let owner: TestUser;
  let outsider: TestUser;
  const documentIds: string[] = [];
  const contextIds: string[] = [];

  beforeEach(async () => {
    await clearCutover();
    storage.deleteObject.mockReset();
    owner = await createAuthenticatedUser('editor');
    outsider = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (documentIds.length) {
      await db.delete(contextDocuments).where(inArray(contextDocuments.id, documentIds.splice(0)));
    }
    if (contextIds.length) {
      await db.delete(contextModificationHistory).where(
        inArray(contextModificationHistory.contextId, contextIds.splice(0)),
      );
    }
    await clearCutover();
    await cleanupAuthData();
    for (const id of [owner.workspaceId, outsider.workspaceId]) {
      if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
    }
  });

  it('executes the exact pinned legacy metadata and download reads', async () => {
    const fixtureRoot = '../fixtures/historical/documents-8799412e0/api/src';
    const source = readFileSync(new URL(`${fixtureRoot}/routes/api/documents.ts`, import.meta.url));
    expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
      .toBe('e7cf8fd53df0f5ad95be0124a0f3dcd651540b13');
    for (const [path, digest] of bridges) {
      const bridge = readFileSync(new URL(`${fixtureRoot}/${path}`, import.meta.url));
      expect(createHash('sha256').update(bridge).digest('hex'), path).toBe(digest);
    }

    const id = crypto.randomUUID();
    documentIds.push(id);
    await db.insert(contextDocuments).values({
      id, workspaceId: owner.workspaceId!, contextType: 'folder', contextId: 'parity-folder',
      filename: 'parity.pdf', mimeType: 'application/pdf', sizeBytes: 3,
      sourceType: 'local', storageKey: 'documents/parity.pdf', status: 'ready',
      data: { summary: 'Pinned summary', summaryLang: 'en' }, version: 1,
    });
    for (const suffix of ['', '/content']) {
      const path = `/api/v1/documents/${id}${suffix}`;
      const legacy = await authenticatedRequest(historical, 'GET', path, owner.sessionToken!);
      const active = await authenticatedRequest(candidate(), 'GET', path, owner.sessionToken!);
      expect({ status: active.status, body: Buffer.from(await active.arrayBuffer()) })
        .toEqual({ status: legacy.status, body: Buffer.from(await legacy.arrayBuffer()) });
    }
    expect((await authenticatedRequest(
      candidate(), 'GET', `/api/v1/documents/${id}`, outsider.sessionToken!,
    )).status).toBe(404);
  });

  it('executes one durable delete per isolated candidate and historical twin', async () => {
    const candidateId = crypto.randomUUID();
    const historicalId = crypto.randomUUID();
    const candidateContext = crypto.randomUUID();
    const historicalContext = crypto.randomUUID();
    documentIds.push(candidateId, historicalId);
    contextIds.push(candidateContext, historicalContext);
    await db.insert(contextDocuments).values([
      documentRow(candidateId, owner.workspaceId!, candidateContext),
      documentRow(historicalId, owner.workspaceId!, historicalContext),
    ]);

    const candidateDelete = await authenticatedRequest(
      candidate(), 'DELETE', `/api/v1/documents/${candidateId}`, owner.sessionToken!,
    );
    expect(candidateDelete.status).toBe(204);
    expect(await db.select().from(contextDocuments).where(
      eq(contextDocuments.id, candidateId),
    )).toHaveLength(0);
    expect(await db.select().from(contextDocuments).where(
      eq(contextDocuments.id, historicalId),
    )).toHaveLength(1);
    expect(await db.select().from(contextModificationHistory).where(
      eq(contextModificationHistory.contextId, candidateContext),
    )).toHaveLength(1);

    const replay = await authenticatedRequest(
      candidate(), 'DELETE', `/api/v1/documents/${candidateId}`, owner.sessionToken!,
    );
    expect(replay.status).toBe(404);
    expect(await db.select().from(contextModificationHistory).where(
      eq(contextModificationHistory.contextId, candidateContext),
    )).toHaveLength(1);

    const historicalDelete = await authenticatedRequest(
      historical, 'DELETE', `/api/v1/documents/${historicalId}`, owner.sessionToken!,
    );
    expect({ status: candidateDelete.status, body: await candidateDelete.text() })
      .toEqual({ status: historicalDelete.status, body: await historicalDelete.text() });
    expect(await db.select().from(contextDocuments).where(
      inArray(contextDocuments.id, [candidateId, historicalId]),
    )).toHaveLength(0);
    expect(await db.select().from(contextModificationHistory).where(
      eq(contextModificationHistory.contextId, historicalContext),
    )).toHaveLength(1);
  });

  it('matches no-effect upload validation before any document write', async () => {
    const invoke = (app: Hono) => {
      const form = new FormData();
      form.set('context_type', 'folder');
      form.set('context_id', 'missing-file');
      return app.request('/api/v1/documents', {
        method: 'POST',
        headers: { Cookie: `session=${owner.sessionToken}` },
        body: form,
      });
    };
    const legacy = await invoke(historical);
    const active = await invoke(candidate());
    expect({ status: active.status, body: await active.text() })
      .toEqual({ status: legacy.status, body: await legacy.text() });
    expect(await db.select().from(contextDocuments).where(
      eq(contextDocuments.workspaceId, owner.workspaceId!),
    )).toHaveLength(0);
  });
});
