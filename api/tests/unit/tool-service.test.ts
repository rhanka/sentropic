import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolService } from '../../src/services/tool-service';
import { db } from '../../src/db/client';
import {
  useCases,
  chatContexts,
  contextModificationHistory,
  chatSessions,
  chatMessages,
  users,
  folders,
  companies,
  workspaces
} from '../../src/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

describe('Tool Service', () => {
  let testUseCaseId: string;
  let testFolderId: string;
  let testUserId: string;
  let testSessionId: string;

  beforeEach(async () => {
    // Créer un user et une session pour les tests avec sessionId
    testUserId = createId();
    await db.insert(users).values({
      id: testUserId,
      email: `test-${testUserId}@example.com`,
      displayName: 'Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    testSessionId = createId();
    await db.insert(chatSessions).values({
      id: testSessionId,
      userId: testUserId,
      primaryContextType: 'usecase',
      primaryContextId: createId(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Créer un folder de test
    testFolderId = createId();
    await db.insert(folders).values({
      id: testFolderId,
      name: 'Test Folder',
      description: 'Test folder description',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Créer un use case de test avec des données JSONB
    testUseCaseId = createId();
    await db.insert(useCases).values({
      id: testUseCaseId,
      folderId: testFolderId,
      data: {
        name: 'Test Use Case',
        description: 'Test description',
        problem: 'Initial problem',
        solution: 'Initial solution',
        references: [
          { title: 'Reference 1', url: 'https://example.com/1' },
          { title: 'Reference 2', url: 'https://example.com/2' }
        ]
      },
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  afterEach(async () => {
    // Cleanup dans l'ordre inverse des dépendances
    await db.delete(contextModificationHistory).where(eq(contextModificationHistory.contextId, testUseCaseId));
    await db.delete(chatContexts).where(eq(chatContexts.contextId, testUseCaseId));
    await db.delete(useCases).where(eq(useCases.id, testUseCaseId));
    await db.delete(folders).where(eq(folders.id, testFolderId));
    await db.delete(chatSessions).where(eq(chatSessions.id, testSessionId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe('readUseCase', () => {
    it('should read use case data', async () => {
      const result = await toolService.readUseCase(testUseCaseId);

      expect(result.useCaseId).toBe(testUseCaseId);
      expect(result.data).toBeDefined();
      expect((result.data as any).name).toBe('Test Use Case');
      expect((result.data as any).description).toBe('Test description');
    });

    it('should throw error if useCaseId is empty', async () => {
      await expect(toolService.readUseCase('')).rejects.toThrow('useCaseId is required');
    });

    it('should throw error if use case not found', async () => {
      await expect(toolService.readUseCase('non-existent-id')).rejects.toThrow('Use case not found');
    });

    it('should return empty object if data is empty', async () => {
      const useCaseIdEmpty = createId();
      await db.insert(useCases).values({
        id: useCaseIdEmpty,
        folderId: testFolderId,
        data: {},
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const result = await toolService.readUseCase(useCaseIdEmpty);
      expect(result.data).toEqual({});

      // Cleanup
      await db.delete(useCases).where(eq(useCases.id, useCaseIdEmpty));
    });
  });

  describe('updateUseCaseFields', () => {
    it('should update a single field', async () => {
      const result = await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'data.name', value: 'Updated Name' }
        ]
      });

      expect(result.useCaseId).toBe(testUseCaseId);
      expect(result.applied.length).toBe(1);
      expect(result.applied[0].path).toBe('data.name');
      expect(result.applied[0].oldValue).toBe('Test Use Case');
      expect(result.applied[0].newValue).toBe('Updated Name');

      // Vérifier que la DB est mise à jour
      const [updated] = await db.select().from(useCases).where(eq(useCases.id, testUseCaseId));
      expect((updated.data as any).name).toBe('Updated Name');
      expect((updated.data as any).description).toBe('Test description'); // Non modifié
    });

    it('should update multiple fields', async () => {
      const result = await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'data.name', value: 'New Name' },
          { path: 'data.description', value: 'New Description' }
        ]
      });

      expect(result.applied.length).toBe(2);
      
      const [updated] = await db.select().from(useCases).where(eq(useCases.id, testUseCaseId));
      expect((updated.data as any).name).toBe('New Name');
      expect((updated.data as any).description).toBe('New Description');
    });

    it('should update nested fields', async () => {
      const result = await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'data.references.0.title', value: 'Updated Title' }
        ]
      });

      expect(result.applied.length).toBe(1);
      
      const [updated] = await db.select().from(useCases).where(eq(useCases.id, testUseCaseId));
      expect((updated.data as any).references[0].title).toBe('Updated Title');
      expect((updated.data as any).references[0].url).toBe('https://example.com/1'); // Non modifié
    });

    it('should accept path without data. prefix', async () => {
      const result = await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'name', value: 'Name without prefix' }
        ]
      });

      expect(result.applied[0].path).toBe('data.name');
      expect(result.applied[0].newValue).toBe('Name without prefix');
    });

    it('should create context modification history', async () => {
      await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'data.name', value: 'Updated' }
        ]
      });

      const history = await db
        .select()
        .from(contextModificationHistory)
        .where(eq(contextModificationHistory.contextId, testUseCaseId));

      expect(history.length).toBe(1);
      expect(history[0].contextType).toBe('usecase');
      expect(history[0].field).toBe('data.name');
      expect(history[0].oldValue).toBe('Test Use Case');
      expect(history[0].newValue).toBe('Updated');
    });

    it('should create chat context snapshot if sessionId provided', async () => {
      await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        sessionId: testSessionId,
        updates: [
          { path: 'data.name', value: 'Updated with Session' }
        ]
      });

      const contexts = await db
        .select()
        .from(chatContexts)
        .where(eq(chatContexts.contextId, testUseCaseId));

      expect(contexts.length).toBe(1);
      expect(contexts[0].sessionId).toBe(testSessionId);
      expect(contexts[0].contextType).toBe('usecase');
      expect((contexts[0].snapshotBefore as any).name).toBe('Test Use Case');
      expect((contexts[0].snapshotAfter as any).name).toBe('Updated with Session');
      expect(contexts[0].modifications).toBeDefined();
    });

    it('should throw error if useCaseId is empty', async () => {
      await expect(
        toolService.updateUseCaseFields({
          useCaseId: '',
          updates: [{ path: 'data.name', value: 'Test' }]
        })
      ).rejects.toThrow('useCaseId is required');
    });

    it('should throw error if updates array is empty', async () => {
      await expect(
        toolService.updateUseCaseFields({
          useCaseId: testUseCaseId,
          updates: []
        })
      ).rejects.toThrow('updates is required');
    });

    it('should throw error if too many updates (max 50)', async () => {
      const updates = Array.from({ length: 51 }, (_, i) => ({
        path: `data.field${i}`,
        value: `value${i}`
      }));

      await expect(
        toolService.updateUseCaseFields({
          useCaseId: testUseCaseId,
          updates
        })
      ).rejects.toThrow('Too many updates (max 50)');
    });

    it('should throw error if use case not found', async () => {
      await expect(
        toolService.updateUseCaseFields({
          useCaseId: 'non-existent-id',
          updates: [{ path: 'data.name', value: 'Test' }]
        })
      ).rejects.toThrow('Use case not found');
    });

    // Note: Le test "trying to overwrite entire data object" n'est pas testable directement
    // car le path 'data' est normalisé en 'data.data' par normalizeDataPath().
    // La vérification dataSegments.length === 0 dans le code ne peut être déclenchée
    // qu'avec un path vide ou invalide, ce qui serait rejeté plus tôt par normalizeDataPath().

    it('should handle complex nested structures', async () => {
      const complexValue = {
        bullets: ['Point 1', 'Point 2'],
        metadata: {
          author: 'Test Author',
          tags: ['tag1', 'tag2']
        }
      };

      await toolService.updateUseCaseFields({
        useCaseId: testUseCaseId,
        updates: [
          { path: 'data.complex', value: complexValue }
        ]
      });

      const [updated] = await db.select().from(useCases).where(eq(useCases.id, testUseCaseId));
      expect((updated.data as any).complex).toEqual(complexValue);
    });

    it('should execute NOTIFY without error', async () => {
      // Le NOTIFY est difficile à tester unitairement, on vérifie juste que ça ne throw pas
      await expect(
        toolService.updateUseCaseFields({
          useCaseId: testUseCaseId,
          updates: [
            { path: 'data.name', value: 'Test Notify' }
          ]
        })
      ).resolves.not.toThrow();
    });
  });

  describe('company/folder/executive_summary tools (workspace-scoped)', () => {
    let workspaceId: string;
    let companyId: string;
    let folderId: string;
    let useCaseId: string;
    let msgCompanyUpdateId: string;
    let msgFolderUpdateId: string;
    let msgExecutiveSummaryUpdateId: string;
    let msgMatrixUpdateId: string;

    beforeEach(async () => {
      // Workspace required for company/folder tools
      workspaceId = createId();
      await db.insert(workspaces).values({
        id: workspaceId,
        ownerUserId: null,
        name: 'Test Workspace',
        shareWithAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Create a user + session in that workspace
      testUserId = createId();
      await db.insert(users).values({
        id: testUserId,
        email: `test-${testUserId}@example.com`,
        displayName: 'Test User',
        role: 'editor',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      testSessionId = createId();
      await db.insert(chatSessions).values({
        id: testSessionId,
        userId: testUserId,
        workspaceId,
        primaryContextType: 'company',
        primaryContextId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Create chat messages for FK constraints (context_modification_history.message_id)
      msgCompanyUpdateId = createId();
      msgFolderUpdateId = createId();
      msgExecutiveSummaryUpdateId = createId();
      msgMatrixUpdateId = createId();
      await db.insert(chatMessages).values([
        { id: msgCompanyUpdateId, sessionId: testSessionId, role: 'assistant', content: 'test', sequence: 1, createdAt: new Date() },
        { id: msgFolderUpdateId, sessionId: testSessionId, role: 'assistant', content: 'test', sequence: 2, createdAt: new Date() },
        { id: msgExecutiveSummaryUpdateId, sessionId: testSessionId, role: 'assistant', content: 'test', sequence: 3, createdAt: new Date() },
        { id: msgMatrixUpdateId, sessionId: testSessionId, role: 'assistant', content: 'test', sequence: 4, createdAt: new Date() }
      ]);

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
      await db
        .delete(contextModificationHistory)
        .where(
          and(
            inArray(contextModificationHistory.contextType, ['company', 'folder', 'executive_summary']),
            inArray(contextModificationHistory.contextId, [companyId, folderId])
          )
        );
      await db
        .delete(chatContexts)
        .where(
          and(
            inArray(chatContexts.contextType, ['company', 'folder', 'executive_summary']),
            inArray(chatContexts.contextId, [companyId, folderId])
          )
        );

      await db.delete(useCases).where(eq(useCases.id, useCaseId));
      await db.delete(folders).where(eq(folders.id, folderId));
      await db.delete(companies).where(eq(companies.id, companyId));
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, testSessionId));
      await db.delete(chatSessions).where(eq(chatSessions.id, testSessionId));
      await db.delete(users).where(eq(users.id, testUserId));
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

    it('should list folders (idsOnly) in workspace', async () => {
      const res = await toolService.listFolders({ workspaceId, idsOnly: true });
      expect('ids' in res).toBe(true);
      if ('ids' in res) {
        expect(res.ids).toContain(folderId);
        expect(res.count).toBeGreaterThan(0);
      }
    });

    it('should get folder with select and parse JSON fields', async () => {
      const res = await toolService.getFolder(folderId, {
        workspaceId,
        select: ['id', 'name', 'companyId', 'matrixConfig', 'executiveSummary']
      });

      expect(res.folderId).toBe(folderId);
      expect(res.selected).toEqual(['id', 'name', 'companyId', 'matrixConfig', 'executiveSummary']);
      expect(res.data.id).toBe(folderId);
      expect(res.data.name).toBe('Folder 1');
      expect(res.data.companyId).toBe(companyId);

      // matrixConfig / executiveSummary are stored as strings in DB but returned as parsed objects here.
      const mx = res.data.matrixConfig as any;
      const es = res.data.executiveSummary as any;
      expect(typeof mx).toBe('object');
      expect(typeof es).toBe('object');
      expect(mx?.valueAxes).toBeDefined();
      expect(es?.introduction).toBe('Hello');
    });

    it('should get and update a company, writing history + chat context when sessionId provided', async () => {
      const before = await toolService.getCompany(companyId, { workspaceId, select: ['name', 'industry'] });
      expect(before.companyId).toBe(companyId);
      expect(before.data.name).toBe('ACME');

      const updated = await toolService.updateCompanyFields({
        companyId,
        updates: [{ field: 'industry', value: 'Tech' }],
        workspaceId,
        sessionId: testSessionId,
        messageId: msgCompanyUpdateId,
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

    it('should update a folder and write folder history + chat context when sessionId provided', async () => {
      const before = await toolService.getFolder(folderId, { workspaceId, select: ['name', 'executiveSummary'] });
      expect(before.folderId).toBe(folderId);
      expect(before.data.name).toBe('Folder 1');
      expect((before.data as any).executiveSummary?.introduction).toBe('Hello');

      const updated = await toolService.updateFolderFields({
        folderId,
        updates: [
          { field: 'name', value: 'Folder 1 updated' },
          { field: 'executiveSummary', value: { introduction: 'Updated intro (folder)' } }
        ],
        workspaceId,
        sessionId: testSessionId,
        messageId: msgFolderUpdateId,
        toolCallId: 'tool-f-1'
      });
      expect(updated.folderId).toBe(folderId);
      expect(updated.applied.length).toBe(2);
      expect(updated.applied.map((a) => a.field)).toEqual(['name', 'executiveSummary']);

      const after = await toolService.getFolder(folderId, { workspaceId, select: ['name', 'executiveSummary'] });
      expect(after.data.name).toBe('Folder 1 updated');
      expect((after.data as any).executiveSummary?.introduction).toBe('Updated intro (folder)');

      const history = await db
        .select()
        .from(contextModificationHistory)
        .where(and(eq(contextModificationHistory.contextType, 'folder'), eq(contextModificationHistory.contextId, folderId)));
      expect(history.length).toBeGreaterThan(0);
      expect(history.map((h) => h.field)).toEqual(expect.arrayContaining(['name', 'executiveSummary']));

      const contexts = await db
        .select()
        .from(chatContexts)
        .where(and(eq(chatContexts.contextType, 'folder'), eq(chatContexts.contextId, folderId)));
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
        sessionId: testSessionId,
        messageId: msgExecutiveSummaryUpdateId,
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

    it('should get and update matrixConfig (folders.matrixConfig)', async () => {
      const before = await toolService.getMatrix(folderId, { workspaceId });
      expect(before.folderId).toBe(folderId);
      expect(before.matrixConfig).toBeTruthy();

      const updated = await toolService.updateMatrix({
        folderId,
        matrixConfig: { valueAxes: [{ id: 'v1', name: 'Value', weight: 0.3 }], complexityAxes: [] },
        workspaceId,
        sessionId: testSessionId,
        messageId: msgMatrixUpdateId,
        toolCallId: 'tool-mx-1'
      });
      expect(updated.folderId).toBe(folderId);
      expect(updated.applied[0].field).toBe('matrixConfig');

      const after = await toolService.getMatrix(folderId, { workspaceId });
      expect(after.matrixConfig).toBeTruthy();
      expect((after.matrixConfig as any).valueAxes?.[0]?.weight).toBe(0.3);
    });
  });
});

