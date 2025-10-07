import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Prompts API', () => {
  describe('GET /prompts', () => {
    it('should get all prompts', async () => {
      const response = await apiRequest('/api/v1/prompts');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });
});
