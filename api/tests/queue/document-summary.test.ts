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
});


