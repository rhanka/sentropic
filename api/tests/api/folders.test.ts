import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Folders API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  // Helper function to create a test company
  async function createTestCompany() {
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const response = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);
    expect(response.status).toBe(201);
    const data = await response.json();
    return data.id;
  }

  // Helper function to create a test folder
  async function createTestFolder(companyId?: string) {
    const folderData = {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder description',
      ...(companyId && { companyId })
    };

    const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);
    expect(response.status).toBe(201);
    const data = await response.json();
    return data;
  }

  describe('GET /folders', () => {
    it('should get all folders', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/folders', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should get folders filtered by company_id', async () => {
      const companyId = await createTestCompany();
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders?company_id=${companyId}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe('POST /folders', () => {
    it('should create a folder', async () => {
      const companyId = await createTestCompany();
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: companyId
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(folderData.name);
      expect(data.description).toBe(folderData.description);
      expect(data.companyId).toBe(companyId);
    });

    it('should create a folder without company', async () => {
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder without company'
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(folderData.name);
      expect(data.companyId).toBeNull();
    });

    it('should create a folder with matrix config', async () => {
      const matrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value 1', weight: 0.5 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity 1', weight: 0.5 }
        ],
        valueThresholds: [
          { level: 1, points: 10 }
        ],
        complexityThresholds: [
          { level: 1, points: 10 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder with matrix',
        matrixConfig
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.matrixConfig).toBeDefined();
    });

    it('should reject invalid folder data', async () => {
      const invalidFolderData = {
        // Missing required name field
        description: 'Invalid folder'
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, invalidFolderData);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /folders/:id', () => {
    it('should get a specific folder', async () => {
      const folder = await createTestFolder();
      
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(folder.id);
      expect(data.name).toBe(folder.name);
    });

    it('should return 404 for non-existent folder', async () => {
      const nonExistentId = 'non-existent-id';
      
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders/${nonExistentId}`, user.sessionToken!);
      
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /folders/:id', () => {
    it('should update a folder', async () => {
      const folder = await createTestFolder();
      const updateData = {
        name: `Updated Folder ${createTestId()}`,
        description: 'Updated description'
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(updateData.name);
      expect(data.description).toBe(updateData.description);
    });

    it('should partially update a folder', async () => {
      const folder = await createTestFolder();
      const partialUpdate = {
        name: `Partially Updated ${createTestId()}`
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, partialUpdate);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(partialUpdate.name);
      expect(data.description).toBe(folder.description); // Should remain unchanged
    });
  });

  describe('DELETE /folders/:id', () => {
    it('should delete a folder', async () => {
      const folder = await createTestFolder();
      
      const response = await authenticatedRequest(app, 'DELETE', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      
      expect(response.status).toBe(204);

      // Verify it's deleted
      const getResponse = await authenticatedRequest(app, 'GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      expect(getResponse.status).toBe(404);
    });
  });

  describe('GET /folders/:id/matrix', () => {
    it('should get folder matrix config', async () => {
      const matrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value 1', weight: 0.5 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity 1', weight: 0.5 }
        ],
        valueThresholds: [
          { level: 1, points: 10, cases: 5 }
        ],
        complexityThresholds: [
          { level: 1, points: 10, cases: 5 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        matrixConfig
      };

      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);
      expect(createResponse.status).toBe(201);
      const folder = await createResponse.json();

      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders/${folder.id}/matrix`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valueAxes).toBeDefined();
      expect(data.complexityAxes).toBeDefined();
    });
  });

  describe('GET /folders/matrix/default', () => {
    it('should get default matrix config', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/folders/matrix/default', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valueAxes).toBeDefined();
      expect(data.complexityAxes).toBeDefined();
    });
  });

  describe('GET /folders/list/with-matrices', () => {
    it('should get folders with matrix data', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/folders/list/with-matrices', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe('PUT /folders/:id/matrix', () => {
    it('should update folder matrix config', async () => {
      const folder = await createTestFolder();
      const matrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value 1', weight: 0.5 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity 1', weight: 0.5 }
        ],
        valueThresholds: [
          { level: 1, points: 10, cases: 5 }
        ],
        complexityThresholds: [
          { level: 1, points: 10, cases: 5 }
        ]
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}/matrix`, user.sessionToken!, matrixConfig);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valueAxes).toBeDefined();
      expect(data.complexityAxes).toBeDefined();
    });

    it('should reject invalid matrix config', async () => {
      const folder = await createTestFolder();
      const invalidMatrixConfig = {
        // Invalid structure
        invalidField: 'invalid'
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}/matrix`, user.sessionToken!, invalidMatrixConfig);
      
      expect(response.status).toBe(400);
    });
  });
});