import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser, createMockCredential } from '../../utils/auth-helper';

describe('Authentication API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('POST /api/v1/auth/login/options', () => {
    it('should generate authentication options without email (discoverable credentials)', async () => {
      const res = await app.request('/api/v1/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.options).toBeDefined();
      expect(data.options.challenge).toBeDefined();
      expect(data.options.rpId).toBeDefined();
      expect(data.options.timeout).toBeDefined();
      if (data.options.allowCredentials !== undefined) {
        expect(Array.isArray(data.options.allowCredentials)).toBe(true);
      }
    });

    it('should generate authentication options with email', async () => {
      const email = `testuser-${crypto.randomUUID()}@example.com`;
      const user = await createTestUser({
        email,
        displayName: 'Test User',
      });
      await createMockCredential(user.id);

      const res = await app.request('/api/v1/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.options).toBeDefined();
      expect(data.options.challenge).toBeDefined();
      expect(data.options.allowCredentials).toBeDefined();
      expect(data.options.allowCredentials.length).toBeGreaterThan(0);
    });

    it('should generate authentication options for non-existent user email', async () => {
      const res = await app.request('/api/v1/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.options).toBeDefined();
      expect(data.options.challenge).toBeDefined();
      if (data.options.allowCredentials !== undefined) {
        expect(Array.isArray(data.options.allowCredentials)).toBe(true);
      }
    });

    it('should reject request with invalid email format', async () => {
      const res = await app.request('/api/v1/auth/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login/verify', () => {
    it('should reject verification with invalid credential response', async () => {
      const res = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      const res = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: 'Test Device',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification with invalid credential structure', async () => {
      const res = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: 'invalid-credential-format',
          deviceName: 'Test Device',
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
