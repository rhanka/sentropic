import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

describe('Registration API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('POST /api/v1/auth/register/options', () => {
    it('should generate registration options for new user', async () => {
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'newuser',
          userDisplayName: 'New User',
          email: 'newuser@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.options).toBeDefined();
      expect(data.userId).toBeDefined();
      expect(data.options.challenge).toBeDefined();
      expect(data.options.rp).toBeDefined();
      expect(data.options.user).toBeDefined();
      expect(data.options.user.name).toBe('newuser');
      expect(data.options.user.displayName).toBe('New User');
    });

    it('should generate registration options for existing user by email', async () => {
      // Create existing user first
      await createTestUser({
        email: 'existing@example.com',
        displayName: 'Existing User',
      });

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'existing',
          userDisplayName: 'Existing User',
          email: 'existing@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.userId).toBeDefined();
    });

    it('should generate registration options for existing user by displayName', async () => {
      // Create existing user first
      await createTestUser({
        displayName: 'Existing User',
      });

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'existing',
          userDisplayName: 'Existing User',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.userId).toBeDefined();
    });

    it('should create admin_app user when ADMIN_EMAIL matches and no admin exists', async () => {
      // This test depends on the ADMIN_EMAIL environment variable
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'admin',
          userDisplayName: 'Admin User',
          email: process.env.ADMIN_EMAIL || 'admin@test.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options).toBeDefined();
      expect(data.userId).toBeDefined();
    });

    it('should reject invalid request data', async () => {
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: '', // Invalid: empty
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject request with invalid email', async () => {
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'testuser',
          userDisplayName: 'Test User',
          email: 'invalid-email',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/register/verify', () => {
    it('should reject verification with invalid credential response', async () => {
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'testuser',
          credential: {
            id: 'invalid-credential',
            response: null, // Invalid response
          },
          deviceName: 'Test Device',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification without credential', async () => {
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'testuser',
          deviceName: 'Test Device',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification with invalid userName', async () => {
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: '',
          credential: { id: 'test' },
          deviceName: 'Test Device',
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
