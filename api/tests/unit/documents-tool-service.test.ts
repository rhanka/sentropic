import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments, ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { toolService } from '../../src/services/tool-service';
import { createId } from '../../src/utils/id';
import { eq } from 'drizzle-orm';

vi.mock('../../src/services/storage-s3', async () => {
  return {
    getDocumentsBucketName: () => 'test-bucket',
    getObjectBytes: async () => new Uint8Array([1, 2, 3]),
  };
});

const mockExtract = vi.fn();
vi.mock('../../src/services/document-text', async () => {
  return {
    extractDocumentInfoFromDocument: (args: any) => mockExtract(args),
  };
});

const mockCallOpenAI = vi.fn();
vi.mock('../../src/services/openai', async () => {
  return {
    callOpenAI: (args: any) => mockCallOpenAI(args),
  };
});

describe('ToolService (documents) - unit', () => {
  const workspaceId = ADMIN_WORKSPACE_ID;
  const contextType = 'usecase' as const;
  const contextId = `uc_${createId()}`;
  let docId = '';

  afterEach(async () => {
    if (docId) {
      await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
    }
    docId = '';
    mockExtract.mockReset();
    mockCallOpenAI.mockReset();
  });

  it('getDocumentContent: maxChars clips full_text when <= 10k words', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'small.md',
      mimeType: 'text/markdown',
      sizeBytes: 10,
      storageKey: 'documents/test/small.md',
      status: 'ready',
      data: { summary: 'Résumé', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    mockExtract.mockResolvedValueOnce({
      text: 'a'.repeat(5000),
      metadata: { pages: 1, title: 'T' },
      headingsH1: [],
    });

    const res = await toolService.getDocumentContent({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      maxChars: 1000,
    });

    expect(res.contentMode).toBe('full_text');
    expect(res.clipped).toBe(true);
    expect(res.content).toContain('…(tronqué)…');
  });

  it('getDocumentContent: returns persisted detailed summary when extracted.words > 10k', async () => {
    docId = createId();
    const detailed = 'résumé '.repeat(9000).trim();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/big.pdf',
      status: 'ready',
      data: {
        summary: 'Résumé court',
        summaryLang: 'fr',
        extracted: { words: 15000, pages: 10, title: 'Big' },
        detailedSummary: detailed,
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await toolService.getDocumentContent({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
    });

    expect(res.contentMode).toBe('detailed_summary');
    expect(res.words).toBeGreaterThan(10000);
    expect(res.contentWords).toBeGreaterThan(8000);
    expect(res.clipped).toBe(false);
    expect(res.content).toContain('résumé');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('getDocumentContent: auto-repair when stored detailed summary exists but is < 8000 words', async () => {
    docId = createId();
    const tooShort = 'court '.repeat(2000).trim();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'old.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/old.pdf',
      status: 'ready',
      data: {
        summary: 'Résumé court',
        summaryLang: 'fr',
        extracted: { words: 20000, pages: 20, title: 'Old' },
        detailedSummary: tooShort,
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    // Full extracted text (long doc)
    mockExtract.mockResolvedValueOnce({
      text: 'mot '.repeat(20050).trim(),
      metadata: { pages: 20, title: 'Old' },
      headingsH1: [],
    });

    // GenerateDetailedSummaryFromText uses callOpenAI under the hood.
    const repaired = 'réparé '.repeat(9000).trim(); // 9k words
    mockCallOpenAI.mockImplementation(async () => ({
      choices: [{ message: { content: repaired } }],
    }));

    const res = await toolService.getDocumentContent({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
    });

    expect(res.contentMode).toBe('detailed_summary');
    expect(res.contentWords).toBeGreaterThan(8000);
    expect(res.clipped).toBe(false);
    expect(res.content).toContain('réparé');

    // Persisted in DB (both keys are written for backward compatibility)
    const [row] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, docId)).limit(1);
    const data = (row?.data ?? {}) as any;
    expect(typeof data.detailedSummary).toBe('string');
    expect((data.detailedSummary as string).length).toBeGreaterThan(0);
    expect(typeof data.detailed_summary).toBe('string');
    expect((data.detailed_summary as string).length).toBeGreaterThan(0);
  });

  it('analyzeDocument: always reads full extracted text (even if detailedSummary exists)', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'any.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/any.pdf',
      status: 'ready',
      data: {
        summary: 'Résumé court',
        summaryLang: 'fr',
        detailedSummary: 'ne doit pas être utilisé',
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    mockExtract.mockResolvedValueOnce({
      text: 'texte '.repeat(2000).trim(),
      metadata: { pages: 2, title: 'Any' },
      headingsH1: [],
    });

    mockCallOpenAI.mockResolvedValueOnce({
      choices: [{ message: { content: 'analyse '.repeat(1500) } }],
    });

    const res = await toolService.analyzeDocument({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      prompt: 'Extraire 3 chiffres',
      maxWords: 1000,
    });

    expect(res.mode).toBe('full_text');
    expect(res.analysisWords).toBeLessThanOrEqual(1000);
    expect(res.analysis.length).toBeGreaterThan(0);
    expect(mockExtract).toHaveBeenCalledTimes(1);
  });

  it('listContextDocuments: summaryAvailable reflects presence of data.summary', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/doc.pdf',
      status: 'ready',
      data: { summary: 'Résumé', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const res = await toolService.listContextDocuments({ workspaceId, contextType, contextId });
    expect(res.items.length).toBeGreaterThan(0);
    const item = res.items.find((d) => d.id === docId);
    expect(item?.summaryAvailable).toBe(true);
  });

  it('getDocumentSummary: enforces context match and returns status+summary', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/doc.pdf',
      status: 'ready',
      data: { summary: 'Résumé', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    const ok = await toolService.getDocumentSummary({ workspaceId, contextType, contextId, documentId: docId });
    expect(ok.documentStatus).toBe('ready');
    expect(ok.summary).toBe('Résumé');

    await expect(
      toolService.getDocumentSummary({ workspaceId, contextType: 'folder', contextId, documentId: docId } as any)
    ).rejects.toThrow(/does not match context/i);
  });

  it('analyzeDocument: very long doc uses scan-all-chunks path (no retrieval) and merges', async () => {
    // Force the "very long doc" branch without creating a multi-million char payload.
    const estimateSpy = vi.spyOn(toolService as any, 'estimateTokensFromText').mockReturnValue(700_001);
    const chunkSpy = vi
      .spyOn(toolService as any, 'chunkTextByApproxTokens')
      .mockReturnValue(['chunk_1', 'chunk_2']);

    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'huge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/huge.pdf',
      status: 'ready',
      data: { summary: 'Résumé', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    mockExtract.mockResolvedValueOnce({
      text: 'texte court (mais forcé en très long)',
      metadata: { pages: 200, title: 'Huge' },
      headingsH1: [],
    });

    // 2 chunk calls + 1 merge call
    mockCallOpenAI
      .mockResolvedValueOnce({ choices: [{ message: { content: 'notes chunk 1' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'notes chunk 2' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'réponse finale' } }] });

    const res = await toolService.analyzeDocument({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      prompt: 'Extraire les chiffres',
      maxWords: 500,
    });

    expect(res.mode).toBe('full_text');
    expect(res.analysis.length).toBeGreaterThan(0);
    expect(mockCallOpenAI).toHaveBeenCalledTimes(3);

    estimateSpy.mockRestore();
    chunkSpy.mockRestore();
  });
});


