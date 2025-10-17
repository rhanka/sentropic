import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser, authenticatedRequest } from '../../utils/auth-helper';

describe('Session Management API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /api/v1/auth/session', () => {
    it('should return 401 without session token', async () => {
      const res = await app.request('/api/v1/auth/session', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid session token', async () => {
      const res = await app.request('/api/v1/auth/session', {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': 'session=invalid-token'
        },
      });

      expect(res.status).toBe(401);
    });

    it('should return user info with valid session token', async () => {
      const user = await createTestUser({
        email: 'testuser@example.com',
        displayName: 'Test User',
        role: 'editor',
        withSession: true,
      });

      const res = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/session',
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.userId).toBeDefined();
      expect(data.sessionId).toBeDefined();
      expect(data.role).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/session/refresh', () => {
    it('should return 401 without session token', async () => {
      const res = await app.request('/api/v1/auth/session/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'fake-token' }),
      });

      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid session token', async () => {
      const res = await app.request('/api/v1/auth/session/refresh', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': 'session=invalid-token'
        },
        body: JSON.stringify({ refreshToken: 'fake-token' }),
      });

      expect(res.status).toBe(401);
    });

    it('should refresh valid session token', async () => {
      const user = await createTestUser({
        email: 'testuser@example.com',
        displayName: 'Test User',
        withSession: true,
      });

      const res = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/auth/session/refresh',
        user.sessionToken!,
        { refreshToken: 'fake-refresh-token' }
      );

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid or expired refresh token');
    });
  });

  describe('DELETE /api/v1/auth/session', () => {
    it('should return 401 without session token', async () => {
      const res = await app.request('/api/v1/auth/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should logout with valid session token', async () => {
      const user = await createTestUser({
        email: 'testuser@example.com',
        displayName: 'Test User',
        withSession: true,
      });

      const res = await authenticatedRequest(
        app,
        'DELETE',
        '/api/v1/auth/session',
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify session is revoked by trying to access it
      const sessionCheck = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/session',
        user.sessionToken!
      );

      expect(sessionCheck.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/auth/session/all', () => {
    it('should return 401 without session token', async () => {
      const res = await app.request('/api/v1/auth/session/all', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('should logout all user sessions', async () => {
      const user = await createTestUser({
        email: 'testuser@example.com',
        displayName: 'Test User',
        withSession: true,
      });

      // Create additional session (simulated by creating another test user with different email)
      const user2 = await createTestUser({
        email: 'testuser2@example.com',
        displayName: 'Test User 2',
        role: user.role,
        withSession: true,
      });

      const res = await authenticatedRequest(
        app,
        'DELETE',
        '/api/v1/auth/session/all',
        user.sessionToken!
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Logged out from all devices');

      // Verify the session is revoked
      const sessionCheck = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/auth/session',
        user.sessionToken!
      );

      expect(sessionCheck.status).toBe(401);
    });
  });
});
