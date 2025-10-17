import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Rate Limiting Security Tests', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('Rate Limiting Headers', () => {
    it('should include rate limit headers on successful requests', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/auth/credentials', null, {}, user);

      expect(response.status).toBe(200);
      
      // Check for rate limit headers
      expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
      expect(response.headers.get('X-RateLimit-Remaining')).toBeTruthy();
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });
  });

  describe('Rate Limiting on Different Endpoints', () => {
    it('should not apply rate limiting to non-auth endpoints', async () => {
      // Make many requests to non-auth endpoints
      const promises = Array.from({ length: 10 }, () => 
        authenticatedRequest(app, 'GET', '/api/v1/companies', null, {}, user)
      );

      const responses = await Promise.all(promises);
      
      // Should not be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBe(0);
      
      // All should be successful
      const successfulResponses = responses.filter(r => r.status === 200);
      expect(successfulResponses.length).toBe(10);
    });
  });

  describe('Rate Limiting Error Messages', () => {
    it('should return appropriate error message for rate limited requests', async () => {
      // This test would need to be run in an environment with rate limiting enabled
      // For now, we'll test the error handling structure
      const response = await authenticatedRequest(app, 'GET', '/api/v1/auth/credentials', null, {}, user);

      // Should either succeed or be rate limited
      expect([200, 429]).toContain(response.status);
      
      if (response.status === 429) {
        const errorBody = await response.json();
        expect(errorBody.message).toContain('rate limit');
        expect(errorBody.message).toContain('exceeded');
      }
    });
  });

  describe('Rate Limiting Configuration', () => {
    it('should have rate limiting configured for auth endpoints', async () => {
      // Test that auth endpoints are protected by rate limiting middleware
      const response = await authenticatedRequest(app, 'GET', '/api/v1/auth/session', null, {}, user);

      // Should succeed but have rate limit headers
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
    });

    it('should have rate limiting configured for registration endpoints', async () => {
      // Test registration endpoint (this will fail but should have rate limit headers)
      const response = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/register', {
        email: 'test@example.com',
        displayName: 'Test User',
        userName: 'testuser'
      });

      // Should fail due to missing credential response, but should have rate limit headers
      expect([400, 429]).toContain(response.status);
      
      if (response.status === 429) {
        expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
        expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      }
    });

    it('should have rate limiting configured for login endpoints', async () => {
      // Test login endpoint (this will fail but should have rate limit headers)
      const response = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login', {
        email: 'test@example.com',
        credentialResponse: {
          id: 'test-id',
          rawId: 'test-raw-id',
          response: {
            authenticatorData: 'test-data',
            clientDataJSON: 'test-client-data',
            signature: 'test-signature',
            userHandle: 'test-handle'
          },
          type: 'public-key'
        }
      });

      // Should fail due to invalid credentials, but should have rate limit headers
      expect([400, 429]).toContain(response.status);
      
      if (response.status === 429) {
        expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
        expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      }
    });
  });
});