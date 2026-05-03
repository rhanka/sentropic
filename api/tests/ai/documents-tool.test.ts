import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments, documentConnectorAccounts, users, workspaces, ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { toolService } from '../../src/services/tool-service';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { GOOGLE_WORKSPACE_MIME_TYPES } from '../../src/services/google-drive-client';
import { createConnectedGoogleDriveToken } from '../utils/google-drive-helper';

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

const mockLoadGoogleDriveFileContent = vi.fn();
vi.mock('../../src/services/google-drive-client', async () => {
  const actual = await vi.importActual('../../src/services/google-drive-client');
  return {
    ...actual,
    loadGoogleDriveFileContent: (args: any) => mockLoadGoogleDriveFileContent(args),
  };
});

const mockCallLLM = vi.fn();
vi.mock('../../src/services/llm-runtime', async () => {
  return {
    callLLM: (args: any) => mockCallLLM(args),
  };
});

describe('AI (deterministic) - documents.get_content / documents.analyze (mocked OpenAI)', () => {
  const workspaceId = ADMIN_WORKSPACE_ID;
  const contextType = 'folder' as const;
  const contextId = `f_${createId()}`;
  const googleUserId = `user_${createId()}`;
  let docId = '';
  const googleSourceBase = {
    kind: 'google_drive',
    fileId: 'file_1',
    name: 'Roadmap',
    mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
    exportMimeType: 'text/markdown',
  } as const;

  beforeEach(async () => {
    // Ensure the default workspace exists (FK on context_documents.workspace_id).
    await db
      .insert(workspaces)
      .values({ id: ADMIN_WORKSPACE_ID, name: 'Admin workspace (tests)', shareWithAdmin: false })
      .onConflictDoNothing();

    mockExtract.mockReset();
    mockCallLLM.mockReset();
    mockLoadGoogleDriveFileContent.mockReset();
    docId = '';
  });

  afterEach(async () => {
    if (docId) {
      await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
      docId = '';
    }
    await db.delete(documentConnectorAccounts).where(eq(documentConnectorAccounts.userId, googleUserId));
    await db.delete(users).where(eq(users.id, googleUserId));
  });

  async function connectGoogleDriveUser() {
    await db.insert(users).values({
      id: googleUserId,
      email: `${googleUserId}@example.com`,
      displayName: 'Google Drive Test User',
      role: 'admin_app',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await storeGoogleDriveTokenMaterial({
      userId: googleUserId,
      workspaceId,
      token: createConnectedGoogleDriveToken(),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      },
    });
  }

  async function insertGoogleDriveDocument(data: Record<string, unknown> = {}) {
    docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType,
      contextId,
      filename: 'Roadmap',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
      sizeBytes: 10,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'ready',
      data: {
        summary: 'Résumé',
        summaryLang: 'fr',
        source: googleSourceBase,
        ...data,
      } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
  }

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
    expect(mockCallLLM).not.toHaveBeenCalled();
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
    mockCallLLM
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
    expect(mockCallLLM).toHaveBeenCalledTimes(4);

    // Per-chunk calls are bounded
    for (let i = 0; i < 3; i += 1) {
      const args = mockCallLLM.mock.calls[i]?.[0];
      expect(args?.model).toBe('gpt-4.1-nano');
      expect(args?.maxOutputTokens).toBe(6000);
    }

    // Merge call is bounded (avoid truncation)
    const mergeArgs = mockCallLLM.mock.calls[3]?.[0];
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

  it('documents.get_content (google drive): uses connected user access and preserves sync metadata', async () => {
    await connectGoogleDriveUser();
    await insertGoogleDriveDocument({
      syncStatus: 'stale',
      lastSyncedAt: '2026-04-24T09:00:00.000Z',
      source: {
        ...googleSourceBase,
        webViewLink: 'https://docs.google.com/document/d/file_1',
        modifiedTime: '2026-04-24T09:00:00.000Z',
        version: '99',
      },
    });

    mockLoadGoogleDriveFileContent.mockResolvedValueOnce({
      bytes: new Uint8Array([4, 5, 6]),
      fileName: 'Roadmap.md',
      mimeType: 'text/markdown',
      exportMimeType: 'text/markdown',
    });
    mockExtract.mockResolvedValueOnce({
      text: 'texte '.repeat(500).trim(),
      metadata: { pages: 2, title: 'Roadmap' },
      headingsH1: [],
    });

    const res = await toolService.getDocumentContent({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      userId: googleUserId,
    });

    expect(mockLoadGoogleDriveFileContent).toHaveBeenCalledTimes(1);
    expect(mockLoadGoogleDriveFileContent.mock.calls[0]?.[0]).toMatchObject({
      accessToken: 'google-access-token',
      file: { id: 'file_1', name: 'Roadmap', mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document },
    });
    expect(res.sourceType).toBe('google_drive');
    expect(res.syncStatus).toBe('stale');
    expect(res.lastSyncedAt).toBe('2026-04-24T09:00:00.000Z');
    expect(res.source).toMatchObject({
      kind: 'google_drive',
      fileId: 'file_1',
      name: 'Roadmap',
      exportMimeType: 'text/markdown',
      version: '99',
    });
    expect(res.contentMode).toBe('full_text');
  });

  it('documents.analyze (google drive): scans extracted content with connected user access', async () => {
    await connectGoogleDriveUser();
    await insertGoogleDriveDocument();

    mockLoadGoogleDriveFileContent.mockResolvedValueOnce({
      bytes: new Uint8Array([7, 8, 9]),
      fileName: 'Roadmap.md',
      mimeType: 'text/markdown',
      exportMimeType: 'text/markdown',
    });
    mockExtract.mockResolvedValueOnce({
      text: 'chiffres clés '.repeat(1200).trim(),
      metadata: { pages: 3, title: 'Roadmap' },
      headingsH1: [],
    });
    mockCallLLM.mockResolvedValueOnce({
      choices: [{ message: { content: 'analyse sur le document Drive' } }],
    });

    const res = await toolService.analyzeDocument({
      workspaceId,
      contextType,
      contextId,
      documentId: docId,
      userId: googleUserId,
      prompt: 'Extraire les chiffres clés',
      maxWords: 1200,
    });

    expect(mockLoadGoogleDriveFileContent).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(res.sourceType).toBe('google_drive');
    expect(res.mode).toBe('full_text');
    expect(res.analysis).toContain('analyse sur le document Drive');
  });

  it('documents.analyze (google drive): rejects disconnected user access', async () => {
    await insertGoogleDriveDocument();

    await expect(
      toolService.analyzeDocument({
        workspaceId,
        contextType,
        contextId,
        documentId: docId,
        userId: googleUserId,
        prompt: 'Extraire les chiffres',
      }),
    ).rejects.toThrow('Google Drive account is not connected');
  });
});
