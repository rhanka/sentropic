import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { contextDocuments, documentConnectorAccounts, jobQueue } from '../../src/db/schema';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { GOOGLE_WORKSPACE_MIME_TYPES } from '../../src/services/google-drive-client';
import { createConnectedGoogleDriveToken } from '../utils/google-drive-helper';

const mockPutObject = vi.fn();
const mockDeleteObject = vi.fn();
const mockGetObjectBodyStream = vi.fn();

vi.mock('../../src/services/storage-s3', async () => {
  return {
    getDocumentsBucketName: () => 'test-bucket',
    putObject: (args: any) => mockPutObject(args),
    deleteObject: (args: any) => mockDeleteObject(args),
    getObjectBodyStream: (args: any) => mockGetObjectBodyStream(args),
    // Used by tool-service / queue-manager when reading local docs. Keep as a hard fail in this test suite.
    getObjectBytes: async () => {
      throw new Error('Unexpected S3 read in documents-google-drive tests');
    },
    headObject: async () => {
      throw new Error('Unexpected S3 head in documents-google-drive tests');
    },
  };
});

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

const seedConnectedGoogleDriveAccount = async (user: Awaited<ReturnType<typeof createAuthenticatedUser>>) =>
  storeGoogleDriveTokenMaterial({
    userId: user.id,
    workspaceId: String(user.workspaceId),
    token: createConnectedGoogleDriveToken(),
    identity: {
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
    },
  });

const getStoredGoogleDriveAccountId = async (user: Awaited<ReturnType<typeof createAuthenticatedUser>>) => {
  const [row] = await db
    .select({ id: documentConnectorAccounts.id })
    .from(documentConnectorAccounts)
    .where(eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)))
    .limit(1);
  return row?.id ?? null;
};

describe('Documents API (Google Drive attach)', () => {
  let app: any;
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let viewer: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  const createdDocIds: string[] = [];
  const createdJobIds: string[] = [];
  let addJobSpy: any;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    mockPutObject.mockReset();
    mockDeleteObject.mockReset();
    mockGetObjectBodyStream.mockReset();

    app = await importApp();
    user = await createAuthenticatedUser('editor');
    viewer = await createAuthenticatedUser('guest');

    const qm = await import('../../src/services/queue-manager');
    addJobSpy = vi.spyOn(qm.queueManager, 'addJob').mockImplementation(async (type: any, data: any, opts: any) => {
      const id = `job_${crypto.randomUUID()}`;
      createdJobIds.push(id);
      await db.insert(jobQueue).values({
        id,
        type: String(type),
        status: 'pending',
        workspaceId: String(opts?.workspaceId ?? ''),
        data: JSON.stringify(data ?? {}),
        createdAt: new Date(),
      });
      return id;
    });
  });

  afterEach(async () => {
    for (const id of createdDocIds.splice(0)) {
      await db.delete(contextDocuments).where(eq(contextDocuments.id, id));
    }
    for (const id of createdJobIds.splice(0)) {
      await db.delete(jobQueue).where(eq(jobQueue.id, id));
    }
    if (user?.id && user?.workspaceId) {
      await db
        .delete(documentConnectorAccounts)
        .where(eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)));
    }
    if (addJobSpy) addJobSpy.mockRestore();
    vi.unstubAllGlobals();
    await cleanupAuthData();
  });

  it('rejects attach when Google Drive is disconnected', async () => {
    const res = await app.request('/api/v1/documents/google-drive', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context_type: 'folder',
        context_id: 'f_1',
        file_ids: ['file_1'],
      }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Google Drive account is not connected',
    });
  });

  it('attaches Google Drive document refs (no S3 upload) and enqueues document_summary', async () => {
    await seedConnectedGoogleDriveAccount(user);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          webViewLink: 'https://docs.google.com/document/d/file_1',
          webContentLink: null,
          iconLink: null,
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '42',
          size: null,
          md5Checksum: null,
          trashed: false,
          driveId: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/api/v1/documents/google-drive', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context_type: 'folder',
        context_id: 'f_1',
        file_ids: ['file_1'],
      }),
    });

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      filename: 'Roadmap',
      mime_type: GOOGLE_WORKSPACE_MIME_TYPES.document,
      size_bytes: 0,
    });
    const docId = payload.items[0].id as string;
    createdDocIds.push(docId);

    expect(mockPutObject).toHaveBeenCalledTimes(0);
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(row).toBeTruthy();
    expect(row.sourceType).toBe('google_drive');
    expect(row.storageKey).toBeNull();
    expect(row.filename).toBe('Roadmap');
    expect(row.mimeType).toBe(GOOGLE_WORKSPACE_MIME_TYPES.document);
    expect(row.sizeBytes).toBe(0);
    const source = (row.data as any)?.source;
    expect(source).toMatchObject({
      kind: 'google_drive',
      fileId: 'file_1',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      exportMimeType: 'text/markdown',
    });
  });

  it('forbids viewers from attaching documents for non-chat contexts', async () => {
    const res = await app.request('/api/v1/documents/google-drive', {
      method: 'POST',
      headers: {
        Cookie: `session=${viewer.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context_type: 'folder',
        context_id: 'f_1',
        file_ids: ['file_1'],
      }),
    });

    expect(res.status).toBe(403);
  });

  it('lists legacy Google Drive rows with source-visible metadata instead of export metadata', async () => {
    await seedConnectedGoogleDriveAccount(user);
    const accountId = await getStoredGoogleDriveAccountId(user);
    expect(accountId).toBeTruthy();

    const docId = crypto.randomUUID();
    createdDocIds.push(docId);
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId: String(user.workspaceId),
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap.md',
      mimeType: 'text/markdown',
      sizeBytes: 1049,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'ready',
      data: {
        summaryLang: 'fr',
        source: {
          kind: 'google_drive',
          connectorAccountId: accountId,
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          exportMimeType: 'text/markdown',
          size: '1049',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '41',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await app.request('/api/v1/documents?context_type=folder&context_id=f_1', {
      method: 'GET',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: docId,
          filename: 'Roadmap',
          mime_type: GOOGLE_WORKSPACE_MIME_TYPES.document,
          size_bytes: 1049,
        }),
      ]),
    );
  });

  it('downloads Google Drive document content through the connected user account', async () => {
    await seedConnectedGoogleDriveAccount(user);
    const accountId = await getStoredGoogleDriveAccountId(user);
    expect(accountId).toBeTruthy();

    const docId = crypto.randomUUID();
    createdDocIds.push(docId);
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId: String(user.workspaceId),
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      sizeBytes: 0,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'ready',
      data: {
        summary: 'Old summary',
        summaryLang: 'fr',
        source: {
          kind: 'google_drive',
          connectorAccountId: accountId,
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          exportMimeType: 'text/markdown',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '41',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(`/api/v1/documents/${docId}/content`, {
      method: 'GET',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.headers.get('content-disposition') || '').toContain('Roadmap.docx');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([80, 75, 3, 4]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/files/file_1/export');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer google-access-token',
      },
    });
  });

  it('returns 409 when Google Drive content is requested without a connected user account', async () => {
    const docId = crypto.randomUUID();
    createdDocIds.push(docId);
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId: String(user.workspaceId),
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      sizeBytes: 0,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'ready',
      data: {
        summary: 'Old summary',
        summaryLang: 'fr',
        source: {
          kind: 'google_drive',
          connectorAccountId: 'connector_missing',
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          exportMimeType: 'text/markdown',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '41',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await app.request(`/api/v1/documents/${docId}/content`, {
      method: 'GET',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Google Drive account is not connected',
    });
  });

  it('requeues Google Drive documents for resync and refreshes stored metadata', async () => {
    await seedConnectedGoogleDriveAccount(user);
    const accountId = await getStoredGoogleDriveAccountId(user);
    expect(accountId).toBeTruthy();

    const docId = crypto.randomUUID();
    createdDocIds.push(docId);
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId: String(user.workspaceId),
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      sizeBytes: 0,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'ready',
      data: {
        summary: 'Old summary',
        summaryLang: 'fr',
        syncStatus: 'indexed',
        lastSyncedAt: '2026-04-22T12:00:00.000Z',
        source: {
          kind: 'google_drive',
          connectorAccountId: accountId,
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          exportMimeType: 'text/markdown',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '41',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          webViewLink: 'https://docs.google.com/document/d/file_1',
          webContentLink: null,
          iconLink: null,
          modifiedTime: '2026-04-24T09:00:00.000Z',
          version: '99',
          size: null,
          md5Checksum: null,
          trashed: false,
          driveId: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request(`/api/v1/documents/${docId}/resync`, {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      id: docId,
      source_type: 'google_drive',
      status: 'uploaded',
      sync_status: 'pending',
    });
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy.mock.calls[0]?.[0]).toBe('document_summary');
    expect(addJobSpy.mock.calls[0]?.[1]).toMatchObject({ documentId: docId, lang: 'fr' });

    const [row] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(row?.status).toBe('uploaded');
    expect(row?.jobId).toBeTruthy();
    expect(row?.filename).toBe('Roadmap');
    expect(row?.mimeType).toBe(GOOGLE_WORKSPACE_MIME_TYPES.document);
    expect(row?.sizeBytes).toBe(0);
    const data = (row?.data ?? {}) as any;
    expect(data.summary).toBe('Old summary');
    expect(data.syncStatus).toBe('pending');
    expect(data.lastSyncError ?? null).toBeNull();
    expect(data.source).toMatchObject({
      kind: 'google_drive',
      connectorAccountId: accountId,
      fileId: 'file_1',
      name: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      exportMimeType: 'text/markdown',
      modifiedTime: '2026-04-24T09:00:00.000Z',
      version: '99',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});
