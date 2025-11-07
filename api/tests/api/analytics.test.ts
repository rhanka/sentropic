import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Analytics API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /analytics/summary', () => {
    it('should get analytics summary', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/analytics/summary?folder_id=test-folder-id', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });

  describe('GET /analytics/scatter', () => {
    it('should get analytics scatter data', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/analytics/scatter?folder_id=test-folder-id', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });
});
