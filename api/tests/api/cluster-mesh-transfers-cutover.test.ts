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

const bridges = [
  ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
  ['db/schema.ts', 'becc16a83cdec26457f0dfe1f83f8d5c381a2e21b55491fd72abab584bdd8492'],
  ['services/storage-s3.ts', '964b5aefd2f186ee2047c6b24b52e87fcacdde037f983fd49c450e2941966da5'],
  ['services/workspace-access.ts', '128364cb1712e7b5c70d88b33a34199af1254b624b337e82e95cd230849fa110'],
  ['utils/id.ts', '7148d17b36975340ed8d20ae49c96a1b06f7d107b9b2492e32e15fe169a24aa3'],
] as const;

describe('cluster mesh transfers cutover', () => {
  let owner: TestUser;
  let artifactRoot: string;
  const workspaceIds = new Set<string>();

  beforeEach(async () => {
    await clearCutover();
    artifactRoot = join(tmpdir(), `transfer-cutover-${process.pid}-${crypto.randomUUID()}`);
    setArtifactStoreForTesting(new LocalFsArtifactStore(artifactRoot, 'transfer-cutover'));
    owner = await createAuthenticatedUser('admin');
    workspaceIds.add(owner.workspaceId!);
  });

  afterEach(async () => {
    const ids = [...workspaceIds];
    if (ids.length > 0) {
      await db.delete(comments).where(inArray(comments.workspaceId, ids));
      await db.delete(contextDocuments).where(inArray(contextDocuments.workspaceId, ids));
      await db.delete(initiatives).where(inArray(initiatives.workspaceId, ids));
      await db.delete(folders).where(inArray(folders.workspaceId, ids));
      await db.delete(organizations).where(inArray(organizations.workspaceId, ids));
      await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, ids));
      await db.delete(workspaces).where(inArray(workspaces.id, ids));
    }
    workspaceIds.clear();
    await clearCutover();
    await cleanupAuthData();
    setArtifactStoreForTesting(undefined);
    await fs.rm(artifactRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('executes the pinned authenticated manifest and storage read parity', async () => {
    const fixtureRoot = '../fixtures/historical/transfers-be37d69f6/api';
    const source = readFileSync(new URL(`${fixtureRoot}/src/routes/api/import-export.ts`, import.meta.url));
    expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
      .toBe('07102840c30953ce293db51fd85adc85bb2e08c7');
    const journal = readFileSync(new URL(`${fixtureRoot}/drizzle/meta/_journal.json`, import.meta.url));
    expect(createHash('sha1').update(`blob ${journal.byteLength}\0`).update(journal).digest('hex'))
      .toBe('afd23b5a944fe172bd77bcee5df43ea04c64c429');
    for (const [path, digest] of bridges) {
      const bridge = readFileSync(new URL(`${fixtureRoot}/src/${path}`, import.meta.url));
      expect(createHash('sha256').update(bridge).digest('hex'), path).toBe(digest);
    }

    const orgId = crypto.randomUUID();
    const folderId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const storageKey = `transfers/${documentId}.txt`;
    const now = new Date('2026-09-01T12:00:00.000Z');
    await db.insert(organizations).values({
      id: orgId, workspaceId: owner.workspaceId!, name: 'Parity org', status: 'completed',
      data: {}, createdAt: now, updatedAt: now,
    });
    await db.insert(folders).values({
      id: folderId, workspaceId: owner.workspaceId!, name: 'Parity folder', description: null,
      organizationId: orgId, matrixConfig: null, executiveSummary: null,
      status: 'completed', createdAt: now,
    });
    await db.insert(initiatives).values({
      id: initiativeId, workspaceId: owner.workspaceId!, folderId, organizationId: orgId,
      status: 'completed', model: null, data: { name: 'Parity initiative' }, createdAt: now,
    });
    const documentBytes = new TextEncoder().encode('authoritative storage parity');
    await getArtifactStore().put({
      bucket: getArtifactStore().defaultBucket(), key: storageKey, body: documentBytes,
      contentType: 'text/plain',
    });
    await db.insert(contextDocuments).values({
      id: documentId, workspaceId: owner.workspaceId!, contextType: 'initiative',
      contextId: initiativeId, filename: 'parity.txt', mimeType: 'text/plain',
      sizeBytes: documentBytes.byteLength, sourceType: 'local', storageKey,
      status: 'ready', data: { summaryLang: 'en' }, version: 1,
    });

    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-02T00:00:00.000Z');
    const request = (app: Hono) => authenticatedRequest(
      app, 'POST', '/api/v1/exports', owner.sessionToken!, {
        scope: 'workspace', include_comments: false, include_documents: true,
      },
    );
    const legacyResponse = await request(historical);
    const candidateResponse = await request(candidate());
    expect(candidateResponse.status).toBe(legacyResponse.status);
    expect(candidateResponse.headers.get('content-type')).toBe(legacyResponse.headers.get('content-type'));
    expect(candidateResponse.headers.get('content-disposition'))
      .toBe(legacyResponse.headers.get('content-disposition'));
    const legacyZip = await JSZip.loadAsync(await legacyResponse.arrayBuffer());
    const candidateZip = await JSZip.loadAsync(await candidateResponse.arrayBuffer());
    expect(Object.keys(candidateZip.files).sort()).toEqual(Object.keys(legacyZip.files).sort());
    for (const path of ['manifest.json', 'meta.json']) {
      expect(await candidateZip.file(path)!.async('string'))
        .toBe(await legacyZip.file(path)!.async('string'));
    }
    const documentPath = Object.keys(candidateZip.files).find(
      (path) => path.startsWith('documents/') && !path.endsWith('/'),
    )!;
    expect(await candidateZip.file(documentPath)!.async('uint8array'))
      .toEqual(await legacyZip.file(documentPath)!.async('uint8array'));
    expect(await candidateZip.file(documentPath)!.async('uint8array')).toEqual(documentBytes);
  });

  it('matches authenticated preview metadata without a durable effect', async () => {
    const organizationId = crypto.randomUUID();
    const folderId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const archive = await buildArchive([
      { path: `organization_${organizationId}.json`, bytes: encodeJson({
        id: organizationId, name: 'Preview organization', comments: [{ id: 'comment' }],
      }) },
      { path: `folder_${folderId}.json`, bytes: encodeJson({
        id: folderId, name: 'Preview folder', organization_id: organizationId,
      }) },
      { path: `initiative_${initiativeId}.json`, bytes: encodeJson({
        id: initiativeId, data: { name: 'Preview initiative' }, folder_id: folderId,
      }) },
    ]);
    const invoke = (app: Hono) => {
      const form = new FormData();
      form.set('file', new File([archive], 'preview.zip', { type: 'application/zip' }));
      return app.request('/api/v1/imports/preview', {
        method: 'POST', headers: { Cookie: `session=${owner.sessionToken}` }, body: form,
      });
    };

    const before = await db.select({ id: workspaces.id }).from(workspaces);
    const legacyResponse = await invoke(historical);
    const candidateResponse = await invoke(candidate());
    expect({ status: candidateResponse.status, body: await candidateResponse.text() })
      .toEqual({ status: legacyResponse.status, body: await legacyResponse.text() });
    expect(await db.select({ id: workspaces.id }).from(workspaces)).toEqual(before);
    expect(await db.select().from(organizations).where(eq(organizations.id, organizationId)))
      .toHaveLength(0);
  });

  it('rejects manifest limits before import writes or storage effects', async () => {
    const meta = encodeJson({ source: 'bounded-input' });
    const archive = await buildArchive([{ path: 'meta.json', bytes: meta }], {
      files: [{
        path: 'meta.json',
        bytes: TRANSFER_ARCHIVE_LIMITS.maxEntryBytes + 1,
        sha256: sha256(meta),
      }],
    });
    const invoke = (path: string) => {
      const form = new FormData();
      form.set('file', new File([archive], 'bounded.zip', { type: 'application/zip' }));
      return candidate().request(path, {
        method: 'POST', headers: { Cookie: `session=${owner.sessionToken}` }, body: form,
      });
    };

    const before = await db.select({ id: workspaces.id }).from(workspaces);
    for (const path of ['/api/v1/imports/preview', '/api/v1/imports']) {
      const response = await invoke(path);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        message: 'Manifest entry exceeds limit: meta.json',
      });
    }
    expect(await db.select({ id: workspaces.id }).from(workspaces)).toEqual(before);
    await expect(fs.readdir(join(artifactRoot, 'blobs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('denies cross-workspace imports through both admin and editor authorization', async () => {
    const targetOwner = await createAuthenticatedUser('admin');
    const targetWorkspaceId = targetOwner.workspaceId!;
    workspaceIds.add(targetWorkspaceId);
    expect(await db.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, targetWorkspaceId),
      eq(workspaceMemberships.userId, owner.id),
    ))).toHaveLength(0);

    const durableState = async () => ({
      workspaces: await db.select().from(workspaces).orderBy(workspaces.id),
      memberships: await db.select().from(workspaceMemberships).where(
        eq(workspaceMemberships.workspaceId, targetWorkspaceId),
      ),
      organizations: await db.select().from(organizations).where(
        eq(organizations.workspaceId, targetWorkspaceId),
      ),
      folders: await db.select().from(folders).where(
        eq(folders.workspaceId, targetWorkspaceId),
      ),
      initiatives: await db.select().from(initiatives).where(
        eq(initiatives.workspaceId, targetWorkspaceId),
      ),
      comments: await db.select().from(comments).where(
        eq(comments.workspaceId, targetWorkspaceId),
      ),
      documents: await db.select().from(contextDocuments).where(
        eq(contextDocuments.workspaceId, targetWorkspaceId),
      ),
      artifactRootExists: existsSync(artifactRoot),
    });
    const before = await durableState();

    for (const scope of ['workspace', 'folder'] as const) {
      const sourceWorkspaceId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      const folderId = crypto.randomUUID();
      const initiativeId = crypto.randomUUID();
      const documentId = crypto.randomUUID();
      const archive = await buildArchive([
        { path: 'workspaces.json', bytes: encodeJson([{
          id: sourceWorkspaceId, name: `Denied ${scope} import`,
        }]) },
        { path: `organization_${organizationId}.json`, bytes: encodeJson({
          id: organizationId, workspace_id: sourceWorkspaceId, name: 'Denied organization',
        }) },
        { path: `folder_${folderId}.json`, bytes: encodeJson({
          id: folderId, workspace_id: sourceWorkspaceId, name: 'Denied folder',
          organization_id: organizationId,
        }) },
        { path: `initiative_${initiativeId}.json`, bytes: encodeJson({
          id: initiativeId, workspace_id: sourceWorkspaceId, folder_id: folderId,
          organization_id: organizationId, data: { name: 'Denied initiative' },
        }) },
        {
          path: `documents/${sourceWorkspaceId}/initiative/${initiativeId}/${documentId}-denied.txt`,
          bytes: new TextEncoder().encode(`denied ${scope} artifact`),
        },
      ], {
        scope,
        scope_id: scope === 'folder' ? folderId : null,
        include_comments: true,
        include_documents: true,
      });
      const form = new FormData();
      form.set('file', new File([archive], `${scope}.zip`, { type: 'application/zip' }));
      form.set('target_workspace_id', targetWorkspaceId);

      const response = await candidate().request('/api/v1/imports', {
        method: 'POST',
        headers: { Cookie: `session=${owner.sessionToken}` },
        body: form,
      });
      expect(response.status, scope).toBe(403);
      await expect(response.json()).resolves.toEqual({ message: 'Insufficient permissions' });
      expect(await durableState(), scope).toEqual(before);
    }
  });

  it('executes one authoritative import effect per isolated historical twin', async () => {
    const sourceWorkspaceId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const folderId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const workspaceName = `Imported twin ${crypto.randomUUID()}`;
    const documentBytes = new TextEncoder().encode('authoritative imported artifact');
    const archive = await buildArchive([
      { path: 'workspaces.json', bytes: encodeJson([{ id: sourceWorkspaceId, name: workspaceName }]) },
      { path: `organization_${organizationId}.json`, bytes: encodeJson({
        id: organizationId, workspace_id: sourceWorkspaceId, name: 'Imported organization',
        status: 'completed', data: {}, created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      }) },
      { path: `folder_${folderId}.json`, bytes: encodeJson({
        id: folderId, workspace_id: sourceWorkspaceId, name: 'Imported folder',
        description: null, organization_id: organizationId, matrix_config: null,
        executive_summary: null, status: 'completed', created_at: '2026-09-01T00:00:00.000Z',
      }) },
      { path: `initiative_${initiativeId}.json`, bytes: encodeJson({
        id: initiativeId, workspace_id: sourceWorkspaceId, folder_id: folderId,
        organization_id: organizationId, status: 'completed', model: null,
        data: { name: 'Imported initiative' }, created_at: '2026-09-01T00:00:00.000Z',
      }) },
      {
        path: `documents/${sourceWorkspaceId}/initiative/${initiativeId}/${documentId}-proof.txt`,
        bytes: documentBytes,
      },
    ], { include_documents: true });
    const invoke = (app: Hono) => {
      const form = new FormData();
      form.set('file', new File([archive], 'import.zip', { type: 'application/zip' }));
      return app.request('/api/v1/imports', {
        method: 'POST', headers: { Cookie: `session=${owner.sessionToken}` }, body: form,
      });
    };
    const assertTwin = async (workspaceId: string): Promise<void> => {
      expect(await db.select().from(workspaceMemberships).where(
        eq(workspaceMemberships.workspaceId, workspaceId),
      )).toHaveLength(1);
      expect(await db.select().from(organizations).where(
        eq(organizations.workspaceId, workspaceId),
      )).toHaveLength(1);
      expect(await db.select().from(folders).where(eq(folders.workspaceId, workspaceId)))
        .toHaveLength(1);
      expect(await db.select().from(initiatives).where(eq(initiatives.workspaceId, workspaceId)))
        .toHaveLength(1);
      const [document] = await db.select().from(contextDocuments).where(
        eq(contextDocuments.workspaceId, workspaceId),
      );
      expect(document).toBeTruthy();
      expect(await getArtifactStore().getBytes({
        bucket: getArtifactStore().defaultBucket(), key: document.storageKey!,
      })).toEqual(documentBytes);
    };

    const candidateResponse = await invoke(candidate());
    expect(candidateResponse.status).toBe(200);
    const candidateBody = await candidateResponse.json() as Record<string, unknown>;
    const candidateWorkspaceId = String(candidateBody.workspace_id);
    workspaceIds.add(candidateWorkspaceId);
    expect(candidateBody).toMatchObject({ scope: 'workspace', imported: true, target_folder_id: null });
    await assertTwin(candidateWorkspaceId);
    expect(await db.select().from(workspaces).where(eq(workspaces.name, workspaceName)))
      .toHaveLength(1);

    const historicalResponse = await invoke(historical);
    expect(historicalResponse.status).toBe(candidateResponse.status);
    const historicalBody = await historicalResponse.json() as Record<string, unknown>;
    const historicalWorkspaceId = String(historicalBody.workspace_id);
    workspaceIds.add(historicalWorkspaceId);
    expect({ ...historicalBody, workspace_id: '<generated>' })
      .toEqual({ ...candidateBody, workspace_id: '<generated>' });
    expect(historicalWorkspaceId).not.toBe(candidateWorkspaceId);
    await assertTwin(historicalWorkspaceId);
    await assertTwin(candidateWorkspaceId);
    expect(await db.select().from(workspaces).where(eq(workspaces.name, workspaceName)))
      .toHaveLength(2);
  });

  it('selects one direct author and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    const first = await authenticatedRequest(app, 'POST', '/api/v1/exports', owner.sessionToken!, {
      scope: 'workspace', include_comments: false, include_documents: false,
    });
    expect(first.status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: TRANSFER_AUTHOR,
      previousGenerationId: 'legacy-api-transfers-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-import-export-router' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      app, 'POST', '/api/v1/exports', owner.sessionToken!, { scope: 'workspace' },
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no anonymous, disabled, duplicate-prefix, or unavailable-control fallback', async () => {
    const invoke = (app: Hono, path: string, authenticated: boolean) => {
      const headers = authenticated ? { Cookie: `session=${owner.sessionToken}` } : undefined;
      if (path === '/api/v1/exports') {
        return app.request(path, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'workspace' }),
        });
      }
      return app.request(path, { method: 'POST', headers, body: new FormData() });
    };
    for (const path of ['/api/v1/exports', '/api/v1/imports/preview', '/api/v1/imports']) {
      expect((await invoke(candidate(), path, false)).status, path).toBe(401);
      expect((await invoke(candidate(false), path, true)).status, path).toBe(404);
    }
    expect(await cutovers.find(key)).toBeNull();
    expect((await productApp.request('/api/v1/transfers/exports', { method: 'POST' })).status)
      .toBe(404);
    expect((await productApp.request('/api/v1/exports/exports', { method: 'POST' })).status)
      .toBe(404);

    const unavailable: TransfersCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const unavailableApp = candidate(true, productTransfersPorts, unavailable);
    for (const path of ['/api/v1/exports', '/api/v1/imports/preview', '/api/v1/imports']) {
      const blocked = await invoke(unavailableApp, path, true);
      expect(blocked.status, path).toBe(503);
      await expect(blocked.json()).resolves.toEqual({ error: 'transfer_control_unavailable' });
    }
  });

  it('registers exact method fences over a neutral injectable transport', async () => {
    const immutableRoutes = [
      ['POST', '/exports'], ['POST', '/imports/preview'], ['POST', '/imports'],
    ] as const;
    expect(TRANSFER_ROUTES).toEqual(immutableRoutes);
    expect(TRANSFER_PATHS).toEqual(['/exports', '/imports/preview', '/imports']);
    expect(TRANSFER_PATHS).not.toContain('/*');
    const transportPaths = [...new Set(
      createTransfersTransportRouter(productTransfersPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(transportPaths).toEqual([...TRANSFER_PATHS].sort());
    const routes = createTransfersNamespaceModule().createRouter().routes;
    for (const [method, path] of immutableRoutes) {
      expect(routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ method, path, handler: requireAuth }),
      ]));
    }
    const source = readFileSync(
      new URL('../../src/routes/namespaces/transfers.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    expect(source).not.toMatch(/\.use\(['"]\*['"]/);
    for (const missing of ['domain', 'storage', 'authorization', 'archive'] as const) {
      expect(() => createTransfersTransportRouter({
        ...productTransfersPorts, [missing]: undefined,
      } as unknown as TransfersNamespacePorts), missing)
        .toThrowError('transfer product ports are unavailable');
    }

    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/transfers',
    );
    expect(registration?.module.namespace).toBe('/transfers');
    expect(registration?.authPaths).toEqual(TRANSFER_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/transfers']).toBe('/');
    expect((await productApp.request('/api/v1/exports', { method: 'POST' })).status).toBe(401);
    expect(existsSync(new URL('../../src/routes/api/import-export.ts', import.meta.url))).toBe(false);
    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(/import-export|exportsRouter|importsRouter|transfersRouter/);
  });
});
