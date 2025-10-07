import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Database Connectivity', () => {
  it('should be able to create and read companies', async () => {
    const testCompany = {
      name: `Test Company ${Date.now()}`,
      industry: 'Test Industry',
    };

    // Create company
    const createResponse = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(testCompany),
    });

    expect(createResponse.ok).toBe(true);
    expect(createResponse.data.name).toBe(testCompany.name);

    // Read companies
    const readResponse = await apiRequest('/api/v1/companies');
    expect(readResponse.ok).toBe(true);
    expect(readResponse.data.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createResponse.data.id) {
      await apiRequest(`/api/v1/companies/${createResponse.data.id}`, {
        method: 'DELETE',
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
    });

    expect(createResponse.ok).toBe(true);
    expect(createResponse.data.name).toBe(testFolder.name);

    // Read folders
    const readResponse = await apiRequest('/api/v1/folders');
    expect(readResponse.ok).toBe(true);
    expect(readResponse.data.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createResponse.data.id) {
      await apiRequest(`/api/v1/folders/${createResponse.data.id}`, {
        method: 'DELETE',
      });
    }
  });
});
