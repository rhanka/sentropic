import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments, workspaces, ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { toolService } from '../../src/services/tool-service';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

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

describe('AI (deterministic) - documents.get_content / documents.analyze (mocked OpenAI)', () => {
  const workspaceId = ADMIN_WORKSPACE_ID;
  const contextType = 'folder' as const;
  const contextId = `f_${createId()}`;
  let docId = '';

  beforeEach(async () => {
    // Ensure the default workspace exists (FK on context_documents.workspace_id).
    await db
      .insert(workspaces)
      .values({ id: ADMIN_WORKSPACE_ID, name: 'Admin workspace (tests)', shareWithAdmin: false })
      .onConflictDoNothing();

    mockExtract.mockReset();
    mockCallOpenAI.mockReset();
    docId = '';
  });

  afterEach(async () => {
    if (docId) {
      await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
      docId = '';
    }
  });

  it('documents.get_content (long doc): does not generate; returns placeholder when detailedSummary is missing', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      storageKey: 'documents/test/big.pdf',
      status: 'ready',
      data: { summary: 'Résumé court', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    // Extracted full text is > 10k words so get_content must switch to detailed_summary.
    mockExtract.mockResolvedValueOnce({
      text: 'mot '.repeat(12_500).trim(),
      metadata: { pages: 10, title: 'Big' },
      headingsH1: [],
    });

    const res = await toolService.getDocumentContent({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
    });

    expect(res.contentMode).toBe('detailed_summary');
    expect(res.contentWords).toBeDefined();
    expect(res.clipped).toBe(true);
    expect(res.content).toContain('Résumé détaillé indisponible');
    expect(mockCallOpenAI).not.toHaveBeenCalled();
    expect(mockExtract).toHaveBeenCalledTimes(1);
  });

  it('documents.analyze (very long doc): scans ALL chunks + merge, with bounded maxOutputTokens', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'huge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 999,
      storageKey: 'documents/test/huge.pdf',
      status: 'ready',
      data: { summary: 'Résumé court', summaryLang: 'fr', detailedSummary: 'ne pas utiliser' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    mockExtract.mockResolvedValueOnce({
      text: 'TEXTE_INTEGRAL '.repeat(10_000).trim(),
      metadata: { pages: 82, title: 'Huge' },
      headingsH1: [],
    });

    // Force the "large doc" path without allocating huge strings.
    const estimateSpy = vi.spyOn(toolService as any, 'estimateTokensFromText').mockReturnValue(800_000);
    const chunkSpy = vi
      .spyOn(toolService as any, 'chunkTextByApproxTokens')
      .mockImplementation((_text: string) => ['CHUNK_A', 'CHUNK_B', 'CHUNK_C']);

    // 3 chunks + 1 merge call = 4 calls.
    mockCallOpenAI
      .mockResolvedValueOnce({ choices: [{ message: { content: 'notes A' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'notes B' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'notes C' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'analyse finale' } }] });

    const res = await toolService.analyzeDocument({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      prompt: 'Extraire les chiffres clés',
      maxWords: 1500,
    });

    expect(res.mode).toBe('full_text');
    expect(res.analysis.length).toBeGreaterThan(0);
    expect(mockCallOpenAI).toHaveBeenCalledTimes(4);

    // Per-chunk calls are bounded
    for (let i = 0; i < 3; i += 1) {
      const args = mockCallOpenAI.mock.calls[i]?.[0];
      expect(args?.model).toBe('gpt-4.1-nano');
      expect(args?.maxOutputTokens).toBe(6000);
    }

    // Merge call is bounded (avoid truncation)
    const mergeArgs = mockCallOpenAI.mock.calls[3]?.[0];
    expect(mergeArgs?.model).toBe('gpt-4.1-nano');
    expect(mergeArgs?.maxOutputTokens).toBe(20000);

    estimateSpy.mockRestore();
    chunkSpy.mockRestore();
  });

  it('documents.get_content rejects mismatched context', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'ctx.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/ctx.pdf',
      status: 'ready',
      data: { summary: 'Résumé court', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    await expect(
      toolService.getDocumentContent({
        workspaceId,
        contextType,
        contextId: 'wrong_context',
        documentId: docId,
      })
    ).rejects.toThrow('Security: document does not match context');
  });

  it('documents.get_content rejects non-member workspace access', async () => {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'ws.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'documents/test/ws.pdf',
      status: 'ready',
      data: { summary: 'Résumé court', summaryLang: 'fr' } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    await expect(
      toolService.getDocumentContent({
        workspaceId: 'workspace_other',
        contextType,
        contextId,
        documentId: docId,
      })
    ).rejects.toThrow('Document not found');
  });
});


