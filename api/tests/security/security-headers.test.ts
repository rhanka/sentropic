import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Security Headers Tests', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('Content Security Policy (CSP)', () => {
    it('should include CSP header on all responses', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const cspHeader = response.headers.get('Content-Security-Policy');
      expect(cspHeader).toBeTruthy();
      expect(cspHeader).toContain('default-src');
      expect(cspHeader).toContain('script-src');
      expect(cspHeader).toContain('style-src');
    });

    it('should include strict CSP directives', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      const cspHeader = response.headers.get('Content-Security-Policy');
      expect(cspHeader).toContain("'self'");
      expect(cspHeader).toContain("'unsafe-inline'"); // For development
    });

    it('should include CSP header on error responses', async () => {
      // Test 404 response
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies/non-existent-id', user.sessionToken);

      expect(response.status).toBe(404);
      
      const cspHeader = response.headers.get('Content-Security-Policy');
      expect(cspHeader).toBeTruthy();
    });
  });

  describe('HTTP Strict Transport Security (HSTS)', () => {
    it('should include HSTS header on HTTPS responses', async () => {
      const response = await app.request('/api/v1/companies', {
        method: 'GET',
        headers: {
          'x-forwarded-proto': 'https', // Simulate HTTPS
          'Cookie': `session=${user.sessionToken}`
        }
      });

      expect(response.status).toBe(200);
      
      const hstsHeader = response.headers.get('Strict-Transport-Security');
      expect(hstsHeader).toBeTruthy();
      expect(hstsHeader).toContain('max-age=');
      expect(hstsHeader).toContain('includeSubDomains');
    });

    it('should not include HSTS header on HTTP responses', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const hstsHeader = response.headers.get('Strict-Transport-Security');
      expect(hstsHeader).toBeNull();
    });
  });

  describe('Cross-Origin Embedder Policy (COEP)', () => {
    it('should include COEP header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const coepHeader = response.headers.get('Cross-Origin-Embedder-Policy');
      expect(coepHeader).toBeTruthy();
      expect(['require-corp', 'credentialless']).toContain(coepHeader);
    });
  });

  describe('Cross-Origin Opener Policy (COOP)', () => {
    it('should include COOP header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const coopHeader = response.headers.get('Cross-Origin-Opener-Policy');
      expect(coopHeader).toBeTruthy();
      expect(['same-origin', 'same-origin-allow-popups', 'unsafe-none']).toContain(coopHeader);
    });
  });

  describe('X-Frame-Options', () => {
    it('should include X-Frame-Options header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const frameOptionsHeader = response.headers.get('X-Frame-Options');
      expect(frameOptionsHeader).toBeTruthy();
      expect(['DENY', 'SAMEORIGIN']).toContain(frameOptionsHeader);
    });
  });

  describe('X-Content-Type-Options', () => {
    it('should include X-Content-Type-Options header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const contentTypeOptionsHeader = response.headers.get('X-Content-Type-Options');
      expect(contentTypeOptionsHeader).toBe('nosniff');
    });
  });

  describe('Referrer-Policy', () => {
    it('should include Referrer-Policy header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const referrerPolicyHeader = response.headers.get('Referrer-Policy');
      expect(referrerPolicyHeader).toBeTruthy();
      expect(['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url']).toContain(referrerPolicyHeader);
    });
  });

  describe('X-XSS-Protection', () => {
    it('should include X-XSS-Protection header', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken);

      expect(response.status).toBe(200);
      
      const xssProtectionHeader = response.headers.get('X-XSS-Protection');
      expect(xssProtectionHeader).toBeTruthy();
      expect(xssProtectionHeader).toContain('1');
    });
  });

  describe('Security Headers on Different Endpoints', () => {
    it('should include security headers on auth endpoints', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/auth/session', user.sessionToken);

      expect(response.status).toBe(200);
      
      // Check for key security headers
      expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBeTruthy();
    });

    it('should include security headers on public endpoints', async () => {
      const response = await unauthenticatedRequest(app, 'GET', '/api/v1/health');

      expect(response.status).toBe(200);
      
      // Check for key security headers
      expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBeTruthy();
    });

    it('should include security headers on error responses', async () => {
      // Test 500 error by making an invalid request
      const response = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken, {
        // Missing required fields to trigger validation error
      });

      expect(response.status).toBe(400);
      
      // Check for key security headers even on error responses
      expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBeTruthy();
    });
  });

  describe('Security Headers Consistency', () => {
    it('should have consistent security headers across all endpoints', async () => {
      const endpoints = [
        () => authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken),
        () => authenticatedRequest(app, 'GET', '/api/v1/folders', user.sessionToken),
        () => authenticatedRequest(app, 'GET', '/api/v1/useCases', user.sessionToken),
        () => authenticatedRequest(app, 'GET', '/api/v1/settings', user.sessionToken),
        () => unauthenticatedRequest(app, 'GET', '/api/v1/health')
      ];

      const securityHeaders = [
        'Content-Security-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'X-XSS-Protection'
      ];

      for (const endpoint of endpoints) {
        const response = await endpoint();
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(500);

        for (const headerName of securityHeaders) {
          const headerValue = response.headers.get(headerName);
          expect(headerValue).toBeTruthy();
        }
      }
    });
  });
});