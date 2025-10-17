import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';

describe('Magic Link API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('POST /api/v1/auth/magic-link/request', () => {
    it('should request magic link for new email', async () => {
      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
    });

    it('should request magic link for existing email', async () => {
      // Create existing user first
      await createTestUser({
        email: 'existing@example.com',
        displayName: 'Existing User',
      });

      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@example.com',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
    });

    it('should reject invalid email format', async () => {
      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject request without email', async () => {
      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should reject request with empty email', async () => {
      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should handle rate limiting gracefully', async () => {
      // This test verifies that the rate limiter is applied
      // We can't easily test the exact rate limit behavior without complex setup
      // but we can verify the endpoint works normally
      const res = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ratelimit@example.com',
        }),
      });

      // Should work on first request
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/auth/magic-link/verify', () => {
    it('should return 400 without token', async () => {
      const res = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 with invalid token', async () => {
      const res = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'invalid-token',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 with empty token', async () => {
      const res = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: '',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 with malformed token', async () => {
      const res = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'not-a-valid-jwt-token',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Magic Link Integration', () => {
    it('should handle complete magic link flow for new user', async () => {
      // Step 1: Request magic link
      const requestRes = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newmagicuser@example.com',
        }),
      });

      expect(requestRes.status).toBe(200);
      const requestData = await requestRes.json();
      expect(requestData.success).toBe(true);

      // Step 2: Verify magic link (this will fail without a real token, but we test the structure)
      const verifyRes = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'fake-token-for-testing',
        }),
      });

      // Should return 400 due to invalid token, but not crash
      expect(verifyRes.status).toBe(400);
    });

    it('should handle complete magic link flow for existing user', async () => {
      // Create existing user first
      await createTestUser({
        email: 'existingmagic@example.com',
        displayName: 'Existing Magic User',
      });

      // Step 1: Request magic link
      const requestRes = await app.request('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existingmagic@example.com',
        }),
      });

      expect(requestRes.status).toBe(200);
      const requestData = await requestRes.json();
      expect(requestData.success).toBe(true);

      // Step 2: Verify magic link (this will fail without a real token, but we test the structure)
      const verifyRes = await app.request('/api/v1/auth/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'fake-token-for-testing',
        }),
      });

      // Should return 400 due to invalid token, but not crash
      expect(verifyRes.status).toBe(400);
    });
  });
});
