import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Settings API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /settings', () => {
    it('should get all settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/settings', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
      expect(data).toHaveProperty('openaiModels');
      expect(data).toHaveProperty('prompts');
      expect(data).toHaveProperty('generationLimits');
    });
  });
});
