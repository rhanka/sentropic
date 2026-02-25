import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser, createMockCredential, authenticatedRequest } from '../../utils/auth-helper';

describe('Credentials Management API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /api/v1/auth/credentials', () => {
    it('should return 401 without authentication', async () => {
      const res = await app.request('/api/v1/auth/credentials', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should return empty list for user with no credentials', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const res = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/credentials',
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.credentials).toBeDefined();
      expect(Array.isArray(data.credentials)).toBe(true);
      expect(data.credentials.length).toBe(0);
    });

    it('should return user credentials list', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      // Create mock credentials
      const credentialId1 = await createMockCredential(user.id, 'Device 1');
      const credentialId2 = await createMockCredential(user.id, 'Device 2');

      const res = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/credentials',
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.credentials).toBeDefined();
      expect(Array.isArray(data.credentials)).toBe(true);
      expect(data.credentials.length).toBe(2);
      
      const deviceNames = data.credentials.map((c: any) => c.deviceName);
      expect(deviceNames).toContain('Device 1');
      expect(deviceNames).toContain('Device 2');
    });
  });

  describe('PUT /api/v1/auth/credentials/:id', () => {
    it('should return 401 without authentication', async () => {
      const res = await app.request('/api/v1/auth/credentials/test-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: 'Updated Device Name',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should update credential device name', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const credentialId = await createMockCredential(user.id, 'Original Device');

      const res = await authenticatedRequest(
        app,
        'PUT',
        `/api/v1/auth/credentials/${credentialId}`,
        user.sessionToken!,
        {
          deviceName: 'Updated Device Name',
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.success).toBe(true);
      expect(data.credential).toBeDefined();
      expect(data.credential.deviceName).toBe('Updated Device Name');
    });

    it('should return 404 for non-existent credential', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const nonExistentId = crypto.randomUUID();

      const res = await authenticatedRequest(
        app,
        'PUT',
        `/api/v1/auth/credentials/${nonExistentId}`,
        user.sessionToken!,
        {
          deviceName: 'Updated Device Name',
        }
      );

      expect(res.status).toBe(404);
    });

    it('should return 403 for credential belonging to another user', async () => {
      const user1 = await createTestUser({
        displayName: 'User 1',
        withSession: true,
      });

      const user2 = await createTestUser({
        displayName: 'User 2',
      });

      const credentialId = await createMockCredential(user2.id, 'User 2 Device');

      const res = await authenticatedRequest(
        app,
        'PUT',
        `/api/v1/auth/credentials/${credentialId}`,
        user1.sessionToken!,
        {
          deviceName: 'Hacked Device Name',
        }
      );

      expect(res.status).toBe(403);
    });

    it('should reject invalid device name', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const credentialId = await createMockCredential(user.id, 'Original Device');

      const res = await authenticatedRequest(
        app,
        'PUT',
        `/api/v1/auth/credentials/${credentialId}`,
        user.sessionToken!,
        {
          deviceName: 'a'.repeat(101), // Too long (max 100)
        }
      );

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/auth/credentials/:id', () => {
    it('should return 401 without authentication', async () => {
      const res = await app.request('/api/v1/auth/credentials/test-id', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should delete user credential', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const credentialId = await createMockCredential(user.id, 'Device to Delete');

      const res = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/auth/credentials/${credentialId}`,
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify credential is deleted
      const credentialsRes = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/credentials',
        user.sessionToken!
      );

      expect(credentialsRes.status).toBe(200);
      const credentialsData = await credentialsRes.json();
      expect(credentialsData.credentials.length).toBe(0);
    });

    it('should return 404 for non-existent credential', async () => {
      const user = await createTestUser({
        displayName: 'Test User',
        withSession: true,
      });

      const nonExistentId = crypto.randomUUID();

      const res = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/auth/credentials/${nonExistentId}`,
        user.sessionToken!
      );

      expect(res.status).toBe(404);
    });

    it('should return 403 for credential belonging to another user', async () => {
      const user1 = await createTestUser({
        displayName: 'User 1',
        withSession: true,
      });

      const user2 = await createTestUser({
        displayName: 'User 2',
      });

      const credentialId = await createMockCredential(user2.id, 'User 2 Device');

      const res = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/auth/credentials/${credentialId}`,
        user1.sessionToken!
      );

      expect(res.status).toBe(403);
    });
  });
});
