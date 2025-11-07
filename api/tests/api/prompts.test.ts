import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Prompts API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /prompts', () => {
    it('should get all prompts', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/prompts', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });
});
