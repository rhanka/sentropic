import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('AI Settings API', () => {
  describe('GET /ai-settings', () => {
    it('should get AI settings', async () => {
      const response = await apiRequest('/api/v1/ai-settings');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  describe('GET /ai-settings/all', () => {
    it('should get all AI settings', async () => {
      const response = await apiRequest('/api/v1/ai-settings/all');
      
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('GET /ai-settings/:key', () => {
    it('should get specific AI setting', async () => {
      const response = await apiRequest('/api/v1/ai-settings/default_model');
      
      expect(response.ok).toBe(true);
      expect(response.data).toBeDefined();
    });
  });
});
