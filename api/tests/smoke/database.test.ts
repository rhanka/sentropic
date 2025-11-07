import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Database Connectivity', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should be able to create and read companies', async () => {
    const testCompany = {
      name: `Test Company ${Date.now()}`,
      industry: 'Test Industry',
    };

    // Create company
    const createResponse = await authenticatedHttpRequest('POST', '/api/v1/companies', user.sessionToken!, testCompany);
    expect(createResponse.status).toBe(201);
    const createData = await createResponse.json();
    expect(createData.name).toBe(testCompany.name);

    // Read companies
    const readResponse = await authenticatedHttpRequest('GET', '/api/v1/companies', user.sessionToken!);
    expect(readResponse.status).toBe(200);
    const readData = await readResponse.json();
    expect(readData.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createData.id) {
      await authenticatedHttpRequest('DELETE', `/api/v1/companies/${createData.id}`, user.sessionToken!);
    }
  });

  it('should be able to create and read folders', async () => {
    const testFolder = {
      name: `Test Folder ${Date.now()}`,
      description: 'Test folder description',
    };

    // Create folder
    const createResponse = await authenticatedHttpRequest('POST', '/api/v1/folders', user.sessionToken!, testFolder);
    expect(createResponse.status).toBe(201);
    const createData = await createResponse.json();
    expect(createData.name).toBe(testFolder.name);

    // Read folders
    const readResponse = await authenticatedHttpRequest('GET', '/api/v1/folders', user.sessionToken!);
    expect(readResponse.status).toBe(200);
    const readData = await readResponse.json();
    expect(readData.items.length).toBeGreaterThan(0);

    // Cleanup
    if (createData.id) {
      await authenticatedHttpRequest('DELETE', `/api/v1/folders/${createData.id}`, user.sessionToken!);
    }
  });
});
