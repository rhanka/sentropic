import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments } from '../../src/db/schema';
import { toolService } from '../../src/services/tool-service';
import { createId } from '../../src/utils/id';
import { ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

vi.mock('../../src/services/storage-s3', async () => {
  return {
    getDocumentsBucketName: () => 'test-bucket',
    getObjectBytes: async () => new Uint8Array([1, 2, 3])
  };
});

const mockExtract = vi.fn();
vi.mock('../../src/services/document-text', async () => {
  return {
    extractDocumentInfoFromDocument: (args: any) => mockExtract(args)
  };
});

const mockCallOpenAI = vi.fn();
vi.mock('../../src/services/openai', async () => {
  return {
    callOpenAI: (args: any) => mockCallOpenAI(args)
  };
});

describe('ToolService - documents tool helpers', () => {
  const workspaceId = ADMIN_WORKSPACE_ID;
  const contextType = 'usecase' as const;
  const contextId = `uc_${createId()}`;
  const docId = createId();

  beforeEach(async () => {
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      storageKey: 'documents/test/doc.pdf',
      status: 'ready',
      data: { summary: 'Résumé test', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
  });

  afterEach(async () => {
    await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
    mockExtract.mockReset();
    mockCallOpenAI.mockReset();
  });

  it('listContextDocuments returns documents for a context', async () => {
    const res = await toolService.listContextDocuments({ workspaceId, contextType, contextId });
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe(docId);
    expect(res.items[0].summaryAvailable).toBe(true);
  });

  it('getDocumentSummary returns summary and documentStatus', async () => {
    const res = await toolService.getDocumentSummary({ workspaceId, contextType, contextId, documentId: docId });
    expect(res.documentId).toBe(docId);
    expect(res.documentStatus).toBe('ready');
    expect(res.summary).toBe('Résumé test');
  });

  it('getDocumentSummary enforces context match', async () => {
    await expect(
      toolService.getDocumentSummary({ workspaceId, contextType: 'folder', contextId, documentId: docId })
    ).rejects.toThrow(/does not match context/i);
  });

  it('getDocumentContent returns full_text when <= 10000 words', async () => {
    mockExtract.mockResolvedValueOnce({
      text: 'bonjour '.repeat(200), // 200 words
      metadata: { pages: 2, title: 'T' },
      headingsH1: []
    });
    const res = await toolService.getDocumentContent({ workspaceId, contextType, contextId, documentId: docId });
    expect(res.documentId).toBe(docId);
    expect(res.contentMode).toBe('full_text');
    expect(res.words).toBeGreaterThan(0);
    expect(res.content).toContain('bonjour');
  });

  it('getDocumentContent returns detailed_summary when > 10000 words (no full content)', async () => {
    mockExtract.mockResolvedValueOnce({
      text: 'mot '.repeat(12050), // > 10k words
      metadata: { pages: 10, title: 'Big' },
      headingsH1: []
    });
    mockCallOpenAI.mockResolvedValueOnce({
      choices: [{ message: { content: 'Résumé partie 1' } }]
    });
    const res = await toolService.getDocumentContent({ workspaceId, contextType, contextId, documentId: docId });
    expect(res.contentMode).toBe('detailed_summary');
    expect(res.words).toBeGreaterThan(10000);
    expect(typeof res.content).toBe('string');
    expect(res.content.length).toBeGreaterThan(0);
  });

  it('analyzeDocument runs sub-agent analysis and caps to maxWords', async () => {
    mockExtract.mockResolvedValueOnce({
      text: 'mot '.repeat(200), // small doc => full text allowed
      metadata: { pages: 1, title: 'Small' },
      headingsH1: []
    });
    mockCallOpenAI.mockResolvedValueOnce({
      choices: [{ message: { content: 'a '.repeat(1200) } }]
    });
    const res = await toolService.analyzeDocument({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      prompt: 'Extrais les risques',
      maxWords: 1000
    });
    expect(res.documentId).toBe(docId);
    expect(res.mode).toBe('full_text');
    expect(res.analysisWords).toBeLessThanOrEqual(1000);
    expect(res.analysis.length).toBeGreaterThan(0);
  });
});


