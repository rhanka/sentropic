import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { folders } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Analytics API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /analytics/summary', () => {
    it('should get analytics summary', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/analytics/summary?folder_id=test-folder-id', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });

  describe('GET /analytics/scatter', () => {
    it('should get analytics scatter data', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/analytics/scatter?folder_id=test-folder-id', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
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

    it('should return 400 if folder has no use cases', async () => {
      const folderId = createTestId();
      await db.insert(folders).values({
        id: folderId,
        name: `Test Folder ${createTestId()}`,
        description: 'Empty folder',
        status: 'completed',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        { folder_id: folderId }
      );
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toBe('No use cases found for this folder');

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
  });
});
