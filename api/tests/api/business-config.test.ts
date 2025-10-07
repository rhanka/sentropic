import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Business Config API', () => {
  describe('GET /business-config', () => {
    it('should get business configuration', async () => {
      const response = await apiRequest('/api/v1/business-config');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });
});
