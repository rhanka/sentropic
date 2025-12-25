import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatContexts,
  chatSessions,
  companies,
  contextModificationHistory,
  folders,
  useCases,
  users,
  workspaces
} from '../../src/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { toolService } from '../../src/services/tool-service';

describe('Tool Service - company/folder/executive_summary', () => {
  let workspaceId: string;
  let userId: string;
  let sessionId: string;
  let companyId: string;
  let folderId: string;
  let useCaseId: string;

  beforeEach(async () => {
    workspaceId = createId();
    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: null,
      name: 'Test Workspace',
      shareWithAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `test-${userId}@example.com`,
      displayName: 'Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    sessionId = createId();
    await db.insert(chatSessions).values({
      id: sessionId,
      userId,
      workspaceId,
      primaryContextType: 'company',
      primaryContextId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    companyId = createId();
    await db.insert(companies).values({
      id: companyId,
      workspaceId,
      name: 'ACME',
      industry: 'Manufacturing',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Folder 1',
      description: 'Desc',
      companyId,
      matrixConfig: JSON.stringify({ valueAxes: [], complexityAxes: [] }),
      executiveSummary: JSON.stringify({ introduction: 'Hello' }),
      status: 'completed',
      createdAt: new Date()
    });

    useCaseId = createId();
    await db.insert(useCases).values({
      id: useCaseId,
      workspaceId,
      folderId,
      status: 'completed',
      createdAt: new Date(),
      data: {
        name: 'UC 1',
        description: 'Test',
        references: [{ title: 'Ref', url: 'https://example.com' }]
      }
    });
  });

  afterEach(async () => {
    // tool audit tables (targeted)
    await db
      .delete(contextModificationHistory)
      .where(
        and(
          inArray(contextModificationHistory.contextType, ['company', 'folder', 'executive_summary']),
          inArray(contextModificationHistory.contextId, [companyId, folderId])
        )
      );
    await db.delete(chatContexts).where(and(inArray(chatContexts.contextType, ['company', 'folder', 'executive_summary']), inArray(chatContexts.contextId, [companyId, folderId])));

    await db.delete(useCases).where(eq(useCases.id, useCaseId));
    await db.delete(folders).where(eq(folders.id, folderId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('should list companies (idsOnly) in workspace', async () => {
    const res = await toolService.listCompanies({ workspaceId, idsOnly: true });
    expect('ids' in res).toBe(true);
    if ('ids' in res) {
      expect(res.ids).toContain(companyId);
      expect(res.count).toBeGreaterThan(0);
    }
  });

  it('should get and update a company, writing history + chat context when sessionId provided', async () => {
    const before = await toolService.getCompany(companyId, { workspaceId, select: ['name', 'industry'] });
    expect(before.companyId).toBe(companyId);
    expect(before.data.name).toBe('ACME');

    const updated = await toolService.updateCompanyFields({
      companyId,
      updates: [{ field: 'industry', value: 'Tech' }],
      workspaceId,
      sessionId,
      messageId: 'msg-1',
      toolCallId: 'tool-1'
    });
    expect(updated.companyId).toBe(companyId);
    expect(updated.applied[0].field).toBe('industry');

    const history = await db
      .select()
      .from(contextModificationHistory)
      .where(and(eq(contextModificationHistory.contextType, 'company'), eq(contextModificationHistory.contextId, companyId)));
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].field).toBe('industry');

    const contexts = await db
      .select()
      .from(chatContexts)
      .where(and(eq(chatContexts.contextType, 'company'), eq(chatContexts.contextId, companyId)));
    expect(contexts.length).toBe(1);
  });

  it('should list use cases for a folder with select', async () => {
    const res = await toolService.listUseCasesForFolder(folderId, { workspaceId, select: ['name'] });
    expect('items' in res).toBe(true);
    if ('items' in res) {
      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(useCaseId);
      expect(res.items[0].data.name).toBe('UC 1');
      expect((res.items[0].data as any).description).toBeUndefined();
    }
  });

  it('should update executive summary fields and write executive_summary history', async () => {
    const before = await toolService.getExecutiveSummary(folderId, { workspaceId });
    expect(before.folderId).toBe(folderId);
    expect(before.executiveSummary?.introduction).toBe('Hello');

    await toolService.updateExecutiveSummaryFields({
      folderId,
      updates: [{ field: 'introduction', value: 'Updated intro' }],
      workspaceId,
      sessionId,
      messageId: 'msg-2',
      toolCallId: 'tool-2'
    });

    const after = await toolService.getExecutiveSummary(folderId, { workspaceId });
    expect(after.executiveSummary?.introduction).toBe('Updated intro');

    const history = await db
      .select()
      .from(contextModificationHistory)
      .where(and(eq(contextModificationHistory.contextType, 'executive_summary'), eq(contextModificationHistory.contextId, folderId)));
    expect(history.length).toBe(1);
    expect(history[0].field).toBe('introduction');
  });
});


