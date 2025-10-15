import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiRequest } from '../utils/test-helpers';
import { createTestUser, cleanupTestUser, getAuthHeaders } from '../utils/auth-helper';

describe('API Health', () => {
  let authHeaders: Record<string, string>;
  let userId: string;

  beforeEach(async () => {
    const testUser = await createTestUser('editor');
    authHeaders = getAuthHeaders(testUser.sessionToken);
    userId = testUser.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it('should respond to health check', async () => {
    const response = await apiRequest('/api/v1/health');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  it('should have companies endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/companies', {
      headers: authHeaders,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });

  it('should have folders endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/folders', {
      headers: authHeaders,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });

  it('should have use-cases endpoint accessible', async () => {
    const response = await apiRequest('/api/v1/use-cases', {
      headers: authHeaders,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.items)).toBe(true);
  });
});
