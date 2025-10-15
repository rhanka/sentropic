import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSession,
  validateSession,
  refreshSession,
  revokeSession,
  listUserSessions,
  revokeAllSessions,
} from '../../../src/services/session-manager';
import { db } from '../../../src/db/client';
import { userSessions, users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Session Manager Service', () => {
  const testUserId = crypto.randomUUID();
  
  // Create test user
  beforeEach(async () => {
    await db.insert(users).values({
      id: testUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'editor',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // Clean up after each test
  afterEach(async () => {
    await db.delete(userSessions);
    await db.delete(users);
  });

  describe('createSession', () => {
    it('should create valid session with tokens', async () => {
      const session = await createSession(testUserId, 'editor', {
        name: 'Test Device',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      });

      expect(session.sessionToken).toBeDefined();
      expect(session.refreshToken).toBeDefined();
      expect(session.expiresAt).toBeInstanceOf(Date);
      
      // Session should expire in ~7 days
      const expiresIn = session.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
      expect(expiresIn).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
    });

    it('should store session in database with hashed tokens', async () => {
      const session = await createSession(testUserId, 'editor');
      
      // Session should exist in DB
      const sessions = await listUserSessions(testUserId);
      expect(sessions.length).toBe(1);
      expect(sessions[0].deviceName).toBeNull();
    });

    it('should store device info', async () => {
      await createSession(testUserId, 'editor', {
        name: 'My Laptop',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });
      
      const sessions = await listUserSessions(testUserId);
      expect(sessions[0].deviceName).toBe('My Laptop');
      expect(sessions[0].ipAddress).toBe('192.168.1.1');
      expect(sessions[0].userAgent).toBe('Mozilla/5.0');
    });
  });

  describe('validateSession', () => {
    it('should validate valid session token', async () => {
      const { sessionToken } = await createSession(testUserId, 'editor');
      
      const payload = await validateSession(sessionToken);
      
      expect(payload).toBeDefined();
      expect(payload?.userId).toBe(testUserId);
      expect(payload?.role).toBe('editor');
    });

    it('should reject invalid token', async () => {
      const payload = await validateSession('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject revoked session', async () => {
      const { sessionToken } = await createSession(testUserId, 'editor');
      
      // Get session ID from validate
      const session = await validateSession(sessionToken);
      expect(session).toBeDefined();
      
      // Revoke session
      await revokeSession(session!.sessionId);
      
      // Should now be invalid
      const payload = await validateSession(sessionToken);
      expect(payload).toBeNull();
    });
  });

  describe('refreshSession', () => {
    it('should refresh session with new tokens', async () => {
      const original = await createSession(testUserId, 'editor');
      
      const refreshed = await refreshSession(original.refreshToken);
      
      expect(refreshed).toBeDefined();
      expect(refreshed?.sessionToken).not.toBe(original.sessionToken);
      expect(refreshed?.refreshToken).not.toBe(original.refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      const refreshed = await refreshSession('invalid-refresh-token');
      expect(refreshed).toBeNull();
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all user sessions', async () => {
      // Create multiple sessions
      await createSession(testUserId, 'editor', { name: 'Device 1' });
      await createSession(testUserId, 'editor', { name: 'Device 2' });
      await createSession(testUserId, 'editor', { name: 'Device 3' });
      
      let sessions = await listUserSessions(testUserId);
      expect(sessions.length).toBe(3);
      
      // Revoke all
      await revokeAllSessions(testUserId);
      
      sessions = await listUserSessions(testUserId);
      expect(sessions.length).toBe(0);
    });
  });
});

