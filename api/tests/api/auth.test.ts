import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { users, webauthnChallenges, userSessions, magicLinks } from '../../src/db/schema';

describe('Authentication API Routes', () => {
  // Clean up after each test
  afterEach(async () => {
    await db.delete(userSessions);
    await db.delete(webauthnChallenges);
    await db.delete(magicLinks);
    await db.delete(users);
  });

  describe('POST /auth/register/options', () => {
    it('should generate registration options', async () => {
      const res = await app.request('/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'testuser',
          userDisplayName: 'Test User',
          email: 'test@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.userId).toBeDefined();
      expect(data.options.challenge).toBeDefined();
      expect(data.options.rp).toBeDefined();
      expect(data.options.user).toBeDefined();
    });

    it('should reject invalid request data', async () => {
      const res = await app.request('/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: '', // Invalid: empty
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login/options', () => {
    it('should generate authentication options without username', async () => {
      const res = await app.request('/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.options.challenge).toBeDefined();
    });

    it('should generate authentication options with username', async () => {
      // Create user first
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: 'test@example.com',
        displayName: 'Test',
        role: 'editor',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.request('/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'test@example.com',
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /auth/magic-link/request', () => {
    it('should request magic link for email', async () => {
      const res = await app.request('/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      
      // Token should not be in response for security
      expect(data.token).toBeUndefined();
    });

    it('should reject invalid email', async () => {
      const res = await app.request('/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /auth/session', () => {
    it('should return 401 without session token', async () => {
      const res = await app.request('/auth/session', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /auth/session', () => {
    it('should logout and clear session cookie', async () => {
      const { sessionToken } = await createSession(testUserId, 'editor');
      
      const res = await app.request('/auth/session', {
        method: 'DELETE',
        headers: {
          Cookie: `session=${sessionToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      
      // Cookie should be cleared
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  describe('GET /auth/credentials', () => {
    it('should return 401 without authentication', async () => {
      const res = await app.request('/auth/credentials', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Health check', () => {
    it('should return healthy status', async () => {
      const res = await app.request('/auth/health', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('auth');
    });
  });
});

