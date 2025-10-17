import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('AI Settings API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /ai-settings', () => {
    it('should get AI settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });

  describe('GET /ai-settings/all', () => {
    it('should get all AI settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings/all', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /ai-settings/:key', () => {
    it('should get specific AI setting', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings/default_model', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });
});
