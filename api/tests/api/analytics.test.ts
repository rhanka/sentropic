import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId, sleep } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { folders, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Analytics API', () => {
  let user: any;
  let workspaceId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');

    // Ensure the authenticated user has a private workspace for scoping tests
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, user.id))
      .limit(1);

    if (ws) {
      workspaceId = ws.id;
    } else {
      workspaceId = crypto.randomUUID();
      await db.insert(workspaces).values({
        id: workspaceId,
        ownerUserId: user.id,
        name: `Test Workspace ${createTestId()}`,
        shareWithAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /analytics/summary', () => {
    it('should get analytics summary', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/analytics/summary?folder_id=${folderId}`,
        user.sessionToken!
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();

      await db.delete(folders).where(eq(folders.id, folderId));
    });
  });

  describe('GET /analytics/scatter', () => {
    it('should get analytics scatter data', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/analytics/scatter?folder_id=${folderId}`,
        user.sessionToken!
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();

      await db.delete(folders).where(eq(folders.id, folderId));
    });
  });

  describe('POST /analytics/executive-summary', () => {
    it('should return 400 if folder not found', async () => {
      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        { folder_id: 'non-existent-folder-id' }
      );
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toBe('Folder not found');
    });

    it('should return jobId and job should fail if folder has no use cases', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Empty folder',
        status: 'completed',
      });

      // L'endpoint retourne maintenant 200 avec jobId (asynchrone)
      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        { folder_id: folderId }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('generating');
      expect(data.folder_id).toBe(folderId);

      // Attendre que le job échoue (validation asynchrone)
      let jobStatus: string = 'pending';
      let attempts = 0;
      const maxAttempts = 10;

      while ((jobStatus === 'pending' || jobStatus === 'processing') && attempts < maxAttempts) {
        await sleep(2000);
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${data.jobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();
        jobStatus = job.status;
        if (job.status === 'failed') {
          expect(job.error).toContain('No use cases found');
          break;
        }
        attempts++;
      }

      expect(jobStatus).toBe('failed');

      // Cleanup
      await db.delete(folders).where(eq(folders.id, folderId));
    });


    it('should return 401 without authentication', async () => {
      const response = await app.request('/api/v1/analytics/executive-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: 'test-folder-id' }),
      });
      
      expect(response.status).toBe(401);
    });

    it('should return jobId and status generating', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        { folder_id: folderId }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('generating');
      expect(data.folder_id).toBe(folderId);
      expect(data.message).toBe('Génération de la synthèse exécutive démarrée');

      // Vérifier que le statut du dossier a été mis à jour
      const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
      expect(folder?.status).toBe('generating');

      // Cleanup
      await db.delete(folders).where(eq(folders.id, folderId));
    });

    it('should accept custom value_threshold and complexity_threshold', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        {
          folder_id: folderId,
          value_threshold: 50,
          complexity_threshold: 40
        }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.jobId).toBeDefined();

      // Vérifier que les seuils sont passés au job (via queue)
      await sleep(1000); // Attendre que le job soit créé
      const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${data.jobId}`, user.sessionToken!);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      expect(job.data.valueThreshold).toBe(50);
      expect(job.data.complexityThreshold).toBe(40);

      // Cleanup
      await db.delete(folders).where(eq(folders.id, folderId));
    });

    it('should use default model if not provided', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        { folder_id: folderId }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.jobId).toBeDefined();

      // Vérifier que le modèle par défaut est utilisé (via queue)
      await sleep(1000); // Attendre que le job soit créé
      const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${data.jobId}`, user.sessionToken!);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      expect(job.data.model).toBeDefined();

      // Cleanup
      await db.delete(folders).where(eq(folders.id, folderId));
    });
  });
});
