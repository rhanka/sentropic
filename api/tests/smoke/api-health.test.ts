import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { httpRequest, authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('API Health', () => {
  it('should respond to health check', async () => {
    const response = await httpRequest('/api/v1/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  describe('Authenticated endpoints', () => {
    let user: any;

    beforeEach(async () => {
      user = await createAuthenticatedUser('editor');
    });

    afterEach(async () => {
      await cleanupAuthData();
    });

    it('should have organizations endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/organizations', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have folders endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/folders', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have use-cases endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/use-cases', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
