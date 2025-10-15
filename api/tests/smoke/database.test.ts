import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiRequest } from '../utils/test-helpers';
import { createTestUser, cleanupTestUser, getAuthHeaders } from '../utils/auth-helper';

describe('Database Connectivity', () => {
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

  it('should be able to create and read companies', async () => {
    const testCompany = {
      name: `Test Company ${Date.now()}`,
      industry: 'Test Industry',
    };

    // Create company
    const requestBody = JSON.stringify(testCompany);
    console.log('Sending request body:', requestBody);
    const createResponse = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: requestBody,
      headers: authHeaders,
    });

    if (!createResponse.ok) {
      console.error('Create company failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      console.error('Request headers:', authHeaders);
      console.error('Request body:', testCompany);
    }
    expect(createResponse.ok).toBe(true);
    expect(createResponse.data.name).toBe(testCompany.name);

    // Read companies
    const readResponse = await apiRequest('/api/v1/companies', {
      headers: authHeaders,
    });
    expect(readResponse.ok).toBe(true);
    expect(readResponse.data.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createResponse.data.id) {
      await apiRequest(`/api/v1/companies/${createResponse.data.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    }
  });

  it('should be able to create and read folders', async () => {
    const testFolder = {
      name: `Test Folder ${Date.now()}`,
      description: 'Test folder description',
    };

    // Create folder
    const createResponse = await apiRequest('/api/v1/folders', {
      method: 'POST',
      body: JSON.stringify(testFolder),
      headers: authHeaders,
    });

    if (!createResponse.ok) {
      console.error('Create folder failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      console.error('Request headers:', authHeaders);
      console.error('Request body:', testFolder);
    }
    expect(createResponse.ok).toBe(true);
    expect(createResponse.data.name).toBe(testFolder.name);

    // Read folders
    const readResponse = await apiRequest('/api/v1/folders', {
      headers: authHeaders,
    });
    expect(readResponse.ok).toBe(true);
    expect(readResponse.data.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createResponse.data.id) {
      await apiRequest(`/api/v1/folders/${createResponse.data.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    }
  });
});
