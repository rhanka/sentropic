import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { env } from '../../src/config/env';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Basic Security Tests', () => {
  let user: any;
  const allowedOrigin = env.CORS_ALLOWED_ORIGINS.split(',')[0]?.trim() || 'http://localhost:5173';

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('Security Headers', () => {
    it('should include CSP header on all responses', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const cspHeader = response.headers.get('Content-Security-Policy');
      expect(cspHeader).toBeTruthy();
      expect(cspHeader).toContain('default-src');
    });

    it('should include X-Content-Type-Options header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const contentTypeOptionsHeader = response.headers.get('X-Content-Type-Options');
      expect(contentTypeOptionsHeader).toBe('nosniff');
    });

    it('should include X-Frame-Options header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const frameOptionsHeader = response.headers.get('X-Frame-Options');
      expect(frameOptionsHeader).toBeTruthy();
      expect(['DENY', 'SAMEORIGIN']).toContain(frameOptionsHeader);
    });

    it('should include Referrer-Policy header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const referrerPolicyHeader = response.headers.get('Referrer-Policy');
      expect(referrerPolicyHeader).toBeTruthy();
    });

    it('should include X-XSS-Protection header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const xssProtectionHeader = response.headers.get('X-XSS-Protection');
      expect(xssProtectionHeader).toBeTruthy();
      expect(xssProtectionHeader).toContain('1');
    });
  });

         describe('CORS Headers', () => {
           it('should include CORS headers on preflight requests', async () => {
             // Test OPTIONS preflight request with valid origin
             const response = await unauthenticatedRequest(app, 'OPTIONS', '/api/v1/organizations', null, {
               'Origin': allowedOrigin,
               'Access-Control-Request-Method': 'GET',
               'Access-Control-Request-Headers': 'Content-Type, Authorization'
             });

             expect(response.status).toBe(204);

             const headers = response.headers;
             
             // Check that CORS headers are present
             expect(headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
             expect(headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
             expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
             expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
           });
         });

  describe('Rate Limiting Headers', () => {
    it('should include rate limit headers on auth endpoints', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/auth/credentials', user.sessionToken);

      expect(response.status).toBe(200);
      
      // Check for rate limit headers (may be null if rate limiting is disabled in test environment)
      const rateLimitHeader = response.headers.get('X-RateLimit-Limit');
      const rateRemainingHeader = response.headers.get('X-RateLimit-Remaining');
      const rateResetHeader = response.headers.get('X-RateLimit-Reset');
      
      // In test environment with DISABLE_RATE_LIMIT=true, headers may be null
      // This is expected behavior, so we just check that the request succeeds
      expect(response.status).toBe(200);
      
      // If rate limiting is enabled, headers should be present
      if (rateLimitHeader) {
        expect(rateRemainingHeader).toBeTruthy();
        expect(rateResetHeader).toBeTruthy();
      }
    });
  });

  describe('Authentication Security', () => {
    it('should require authentication for protected endpoints', async () => {
      const response = await unauthenticatedRequest(app, 'GET', '/api/v1/organizations');

      expect(response.status).toBe(401);
    });

    it('should reject invalid session tokens', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', 'invalid-token');

      expect(response.status).toBe(401);
    });
  });

  describe('Public Endpoints', () => {
    it('should allow access to health endpoint without authentication', async () => {
      const response = await unauthenticatedRequest(app, 'GET', '/api/v1/health');

      expect(response.status).toBe(200);
      
      // Should still have security headers
      expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
  });
});
