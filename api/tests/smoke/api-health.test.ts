import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('API Health', () => {
  it('should respond to health check', async () => {
    const response = await apiRequest('/api/v1/health');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  it('should have companies endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/companies');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });

  it('should have folders endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/folders');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });

  it('should have use-cases endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/use-cases');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });
});
