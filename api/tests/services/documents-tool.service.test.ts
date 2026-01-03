import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/client';
import { contextDocuments } from '../../src/db/schema';
import { toolService } from '../../src/services/tool-service';
import { createId } from '../../src/utils/id';
import { ADMIN_WORKSPACE_ID } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

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
      summary: 'Résumé test',
      summaryLang: 'fr',
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
  });

  afterEach(async () => {
    await db.delete(contextDocuments).where(eq(contextDocuments.id, docId));
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
});


