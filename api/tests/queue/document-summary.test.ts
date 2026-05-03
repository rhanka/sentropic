import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments, jobQueue, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

// Avoid hitting NOTIFY / chat_stream_events for these tests; just capture calls.
const streamEvents: Array<{ streamId: string; eventType: string; data: unknown; sequence: number }> = [];
let seqByStream = new Map<string, number>();
vi.mock('../../src/services/stream-service', async () => {
  return {
    getNextSequence: async (streamId: string) => {
      const n = (seqByStream.get(streamId) ?? 0) + 1;
      seqByStream.set(streamId, n);
      return n;
    },
    writeStreamEvent: async (streamId: string, eventType: string, data: unknown, sequence: number) => {
      streamEvents.push({ streamId, eventType, data, sequence });
    },
  };
});

const mockGetObjectBytes = vi.fn();
vi.mock('../../src/services/storage-s3', async () => {
  return {
    getDocumentsBucketName: () => 'test-bucket',
    getObjectBytes: (args: any) => mockGetObjectBytes(args),
  };
});

const mockResolveGoogleDriveFileMetadata = vi.fn();
const mockLoadGoogleDriveFileContent = vi.fn();
vi.mock('../../src/services/google-drive-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/google-drive-client')>(
    '../../src/services/google-drive-client',
  );
  return {
    ...actual,
    resolveGoogleDriveFileMetadata: (args: any) => mockResolveGoogleDriveFileMetadata(args),
    loadGoogleDriveFileContent: (args: any) => mockLoadGoogleDriveFileContent(args),
  };
});

const mockResolveGoogleDriveTokenSecretByAccountId = vi.fn();
vi.mock('../../src/services/google-drive-connector-accounts', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/services/google-drive-connector-accounts')
  >('../../src/services/google-drive-connector-accounts');
  return {
    ...actual,
    resolveGoogleDriveTokenSecretByAccountId: (args: any) =>
      mockResolveGoogleDriveTokenSecretByAccountId(args),
  };
});

const mockExtract = vi.fn();
vi.mock('../../src/services/document-text', async () => {
  return {
    extractDocumentInfoFromDocument: (args: any) => mockExtract(args),
  };
});

const mockGenerateDocumentSummary = vi.fn();
const mockGenerateDocumentDetailedSummary = vi.fn();
vi.mock('../../src/services/context-document', async () => {
  return {
    // Keep the queue test deterministic: do not call OpenAI, just return fixed summaries.
    generateDocumentSummary: (opts: any) => mockGenerateDocumentSummary(opts),
    generateDocumentDetailedSummary: (opts: any) => mockGenerateDocumentDetailedSummary(opts),
    getDocumentDetailedSummaryPolicy: () => ({ detailedSummaryMinWords: 4000 }),
  };
});

async function importQueueManager() {
  const mod = await import('../../src/services/queue-manager');
  return mod.queueManager as any;
}

describe('Queue - document_summary', () => {
  let queueManager: any;
  let docId = '';
  let jobId = '';
  const workspaceId = 'ws_test_docs';

  beforeEach(async () => {
    queueManager = await importQueueManager();
    streamEvents.length = 0;
    seqByStream = new Map<string, number>();
    mockGetObjectBytes.mockReset();
    mockResolveGoogleDriveFileMetadata.mockReset();
    mockLoadGoogleDriveFileContent.mockReset();
    mockResolveGoogleDriveTokenSecretByAccountId.mockReset();
    mockExtract.mockReset();
    mockGenerateDocumentSummary.mockReset();
    mockGenerateDocumentDetailedSummary.mockReset();
    docId = '';
    jobId = '';
  });

  afterEach(async () => {
    if (jobId) await db.delete(jobQueue).where(eq(jobQueue.id, jobId));
    if (docId) await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('processes document_summary: sets status ready and writes summary (+ detailed for long docs), streamId=document_<id>', async () => {
    // workspace FK fixture
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: null, name: 'WS Test Docs', shareWithAdmin: false, createdAt: new Date(), updatedAt: new Date() });

    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      storageKey: 'documents/ws_test_docs/folder/f_1/doc.pdf',
      status: 'uploaded',
      data: { summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    jobId = `job_${createId()}`;
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'document_summary',
      status: 'pending',
      workspaceId,
      data: JSON.stringify({ documentId: docId, lang: 'fr' }),
      createdAt: new Date(),
    });

    mockGetObjectBytes.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    mockExtract.mockResolvedValueOnce({
      // Long doc triggers detailed summary path (> 10k words)
      text: 'mot '.repeat(12050).trim(),
      metadata: { pages: 12, title: 'Titre' },
      headingsH1: [],
    });

    mockGenerateDocumentSummary.mockResolvedValueOnce('Résumé court (test).');
    mockGenerateDocumentDetailedSummary.mockResolvedValueOnce({
      detailedSummary: 'détails '.repeat(9000).trim(),
      words: 9000,
      clipped: false
    });

    await queueManager.processJobs();

    const [doc] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(doc?.status).toBe('ready');
    const data = (doc?.data ?? {}) as any;
    expect(typeof data.summary).toBe('string');
    expect(data.summary).toContain('Résumé');
    expect(typeof data.detailedSummary).toBe('string');
    expect(String(data.detailedSummary).length).toBeGreaterThan(0);

    const streamId = `document_${docId}`;
    expect(streamEvents.some((e) => e.streamId === streamId && e.eventType === 'status')).toBe(true);
    expect(streamEvents.some((e) => e.streamId === streamId && e.eventType === 'done')).toBe(true);
  });

  it('on extraction failure: ends with context_documents.status=failed', async () => {
    await db.insert(workspaces).values({ id: workspaceId, ownerUserId: null, name: 'WS Test Docs', shareWithAdmin: false, createdAt: new Date(), updatedAt: new Date() });

    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      storageKey: 'documents/ws_test_docs/folder/f_1/doc.pdf',
      status: 'uploaded',
      data: { summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    jobId = `job_${createId()}`;
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'document_summary',
      status: 'pending',
      workspaceId,
      data: JSON.stringify({ documentId: docId, lang: 'fr' }),
      createdAt: new Date(),
    });

    mockGetObjectBytes.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    mockExtract.mockRejectedValueOnce(new Error('boom'));

    await queueManager.processJobs();

    const [doc] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(doc?.status).toBe('failed');
  });

  it('processes Google Drive document_summary without S3 reads and refreshes sync metadata', async () => {
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: null,
      name: 'WS Test Docs',
      shareWithAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap',
      mimeType: 'application/vnd.google-apps.document',
      sizeBytes: 0,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'uploaded',
      data: {
        summaryLang: 'fr',
        syncStatus: 'pending',
        source: {
          kind: 'google_drive',
          connectorAccountId: 'gacc_1',
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: 'application/vnd.google-apps.document',
          exportMimeType: 'text/markdown',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '41',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    jobId = `job_${createId()}`;
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'document_summary',
      status: 'pending',
      workspaceId,
      data: JSON.stringify({ documentId: docId, lang: 'fr' }),
      createdAt: new Date(),
    });

    mockResolveGoogleDriveTokenSecretByAccountId.mockResolvedValueOnce({
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scope: 'https://www.googleapis.com/auth/drive.file',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      obtainedAt: '2026-04-22T10:00:00.000Z',
      expiresAt: '2026-04-22T11:00:00.000Z',
    });
    mockResolveGoogleDriveFileMetadata.mockResolvedValueOnce({
      id: 'file_1',
      name: 'Roadmap',
      mimeType: 'application/vnd.google-apps.document',
      webViewLink: 'https://docs.google.com/document/d/file_1',
      webContentLink: null,
      iconLink: null,
      modifiedTime: '2026-04-23T12:30:00.000Z',
      version: '42',
      size: null,
      md5Checksum: null,
      trashed: false,
      driveId: null,
    });
    mockLoadGoogleDriveFileContent.mockResolvedValueOnce({
      bytes: new Uint8Array([10, 20, 30]),
      fileName: 'Roadmap.md',
      mimeType: 'text/markdown',
      exportMimeType: 'text/markdown',
    });
    mockExtract.mockResolvedValueOnce({
      text: 'mot '.repeat(500).trim(),
      metadata: { pages: 2, title: 'Roadmap' },
      headingsH1: [],
    });
    mockGenerateDocumentSummary.mockResolvedValueOnce('Résumé Drive');

    await queueManager.processJobs();

    expect(mockGetObjectBytes).not.toHaveBeenCalled();
    expect(mockResolveGoogleDriveFileMetadata).toHaveBeenCalledTimes(1);
    expect(mockLoadGoogleDriveFileContent).toHaveBeenCalledTimes(1);

    const [doc] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(doc?.status).toBe('ready');
    const data = (doc?.data ?? {}) as any;
    expect(data.syncStatus).toBe('indexed');
    expect(typeof data.lastSyncedAt).toBe('string');
    expect(data.lastSyncError ?? null).toBeNull();
    expect(data.summary).toBe('Résumé Drive');
    expect(data.source).toMatchObject({
      kind: 'google_drive',
      fileId: 'file_1',
      connectorAccountId: 'gacc_1',
      name: 'Roadmap',
      mimeType: 'application/vnd.google-apps.document',
      exportMimeType: 'text/markdown',
      modifiedTime: '2026-04-23T12:30:00.000Z',
      version: '42',
    });
  });

  it('marks Google Drive sync as failed when extraction fails', async () => {
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: null,
      name: 'WS Test Docs',
      shareWithAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: 'folder',
      contextId: 'f_1',
      filename: 'Roadmap',
      mimeType: 'application/vnd.google-apps.document',
      sizeBytes: 0,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'uploaded',
      data: {
        summaryLang: 'fr',
        syncStatus: 'pending',
        source: {
          kind: 'google_drive',
          connectorAccountId: 'gacc_1',
          fileId: 'file_1',
          name: 'Roadmap',
          mimeType: 'application/vnd.google-apps.document',
          exportMimeType: 'text/markdown',
        },
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    jobId = `job_${createId()}`;
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'document_summary',
      status: 'pending',
      workspaceId,
      data: JSON.stringify({ documentId: docId, lang: 'fr' }),
      createdAt: new Date(),
    });

    mockResolveGoogleDriveTokenSecretByAccountId.mockResolvedValueOnce({
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      idToken: null,
      tokenType: 'Bearer',
      scope: 'https://www.googleapis.com/auth/drive.file',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      obtainedAt: '2026-04-22T10:00:00.000Z',
      expiresAt: '2026-04-22T11:00:00.000Z',
    });
    mockResolveGoogleDriveFileMetadata.mockResolvedValueOnce({
      id: 'file_1',
      name: 'Roadmap',
      mimeType: 'application/vnd.google-apps.document',
      webViewLink: null,
      webContentLink: null,
      iconLink: null,
      modifiedTime: '2026-04-23T12:30:00.000Z',
      version: '42',
      size: null,
      md5Checksum: null,
      trashed: false,
      driveId: null,
    });
    mockLoadGoogleDriveFileContent.mockResolvedValueOnce({
      bytes: new Uint8Array([10, 20, 30]),
      fileName: 'Roadmap.md',
      mimeType: 'text/markdown',
      exportMimeType: 'text/markdown',
    });
    mockExtract.mockRejectedValueOnce(new Error('extract failed'));

    await queueManager.processJobs();

    const [doc] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    expect(doc?.status).toBe('failed');
    const data = (doc?.data ?? {}) as any;
    expect(data.syncStatus).toBe('failed');
    expect(String(data.lastSyncError || '')).toContain('extract failed');
  });
});
