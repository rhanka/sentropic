import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Admin API', () => {
  describe('GET /admin/stats', () => {
    it('should get admin statistics', async () => {
      const response = await apiRequest('/api/v1/admin/stats');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });
});
