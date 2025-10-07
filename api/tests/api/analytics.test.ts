import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Analytics API', () => {
  describe('GET /analytics/summary', () => {
    it('should get analytics summary', async () => {
      const response = await apiRequest('/api/v1/analytics/summary?folder_id=test-folder-id');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  describe('GET /analytics/scatter', () => {
    it('should get analytics scatter data', async () => {
      const response = await apiRequest('/api/v1/analytics/scatter?folder_id=test-folder-id');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });
});
