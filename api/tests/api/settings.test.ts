import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Settings API', () => {
  describe('GET /settings', () => {
    it('should get all settings', async () => {
      const response = await apiRequest('/api/v1/settings');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
      expect(typeof response.data).toBe('object');
      expect(response.data).toHaveProperty('openaiModels');
      expect(response.data).toHaveProperty('prompts');
      expect(response.data).toHaveProperty('generationLimits');
    });
  });
});
