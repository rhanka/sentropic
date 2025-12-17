import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolService } from '../../src/services/tool-service';
import { db } from '../../src/db/client';
import { useCases, chatContexts, contextModificationHistory, chatSessions, users, folders } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
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
});

