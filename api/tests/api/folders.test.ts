import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiRequest, createTestId } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';

describe('Folders API', () => {
  // Helper function to create a test company
  async function createTestCompany() {
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const response = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(response.ok).toBe(true);
    return response.data.id;
  }

  afterEach(async () => {
    // Cleanup - get all folders and delete test ones
    const foldersResponse = await apiRequest('/api/v1/folders');
    if (foldersResponse.ok && foldersResponse.data.items) {
      for (const folder of foldersResponse.data.items) {
        if (folder.name.includes('Test Folder')) {
          await apiRequest(`/api/v1/folders/${folder.id}`, { method: 'DELETE' });
        }
      }
    }
    
    // Cleanup - get all companies and delete test ones
    const companiesResponse = await apiRequest('/api/v1/companies');
    if (companiesResponse.ok && companiesResponse.data.items) {
      for (const company of companiesResponse.data.items) {
        if (company.name.includes('Test Company')) {
          await apiRequest(`/api/v1/companies/${company.id}`, { method: 'DELETE' });
        }
      }
    }
  });

  describe('GET /folders', () => {
    it('should get all folders', async () => {
      const response = await apiRequest('/api/v1/folders');
      
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.data.items)).toBe(true);
    });

    it('should get folders filtered by company_id', async () => {
      // First create a company
      const companyData = {
        name: `Test Company ${createTestId()}`,
        industry: testCompanies.valid.industry,
      };

      const companyResponse = await apiRequest('/api/v1/companies', {
        method: 'POST',
        body: JSON.stringify(companyData),
      });

      expect(companyResponse.ok).toBe(true);
      const companyId = companyResponse.data.id;

      const response = await apiRequest(`/api/v1/folders?company_id=${companyId}`);
      
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.data.items)).toBe(true);
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

      const response = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      expect(response.ok).toBe(true);
      expect(response.data.name).toBe(folderData.name);
      expect(response.data.description).toBe(folderData.description);
      expect(response.data.companyId).toBe(companyId);
    });

    it('should create a folder without company', async () => {
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder without company'
      };

      const response = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      expect(response.ok).toBe(true);
      expect(response.data.name).toBe(folderData.name);
      expect(response.data.companyId).toBeNull();
      
      // Folder created successfully
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
          { level: 1, points: 5 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder with matrix',
        matrixConfig
      };

      const response = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      expect(response.ok).toBe(true);
      expect(response.data.matrixConfig).toBeDefined();
    });

    it('should reject invalid folder data', async () => {
      const invalidData = {
        name: '', // Empty name should fail
        description: 'Test'
      };

      const response = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /folders/:id', () => {
    it('should get a specific folder', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then get it
      const getResponse = await apiRequest(`/api/v1/folders/${folderId}`);
      
      expect(getResponse.ok).toBe(true);
      expect(getResponse.data.id).toBe(folderId);
      expect(getResponse.data.name).toBe(folderData.name);
    });

    it('should return 404 for non-existent folder', async () => {
      const response = await apiRequest('/api/v1/folders/non-existent-id');
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /folders/:id', () => {
    it('should update a folder', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then update it
      const updateData = {
        name: `Updated Folder ${createTestId()}`,
        description: 'Updated description'
      };

      const updateResponse = await apiRequest(`/api/v1/folders/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.data.name).toBe(updateData.name);
      expect(updateResponse.data.description).toBe(updateData.description);
    });

    it('should partially update a folder', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then partially update it
      const updateData = {
        name: `Updated Folder ${createTestId()}`
        // Only update name, keep description
      };

      const updateResponse = await apiRequest(`/api/v1/folders/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.data.name).toBe(updateData.name);
      expect(updateResponse.data.description).toBe(folderData.description); // Should remain unchanged
    });
  });

  describe('DELETE /folders/:id', () => {
    it('should delete a folder', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then delete it
      const deleteResponse = await apiRequest(`/api/v1/folders/${folderId}`, {
        method: 'DELETE',
      });

      expect(deleteResponse.ok).toBe(true);
      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const getResponse = await apiRequest(`/api/v1/folders/${folderId}`);
      expect(getResponse.ok).toBe(false);
      expect(getResponse.status).toBe(404);
    });
  });

  describe('GET /folders/:id/matrix', () => {
    it('should get folder matrix config', async () => {
      // First create a folder with matrix
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
          { level: 1, points: 5 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder with matrix',
        matrixConfig
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then get its matrix
      const matrixResponse = await apiRequest(`/api/v1/folders/${folderId}/matrix`);
      
      expect(matrixResponse.ok).toBe(true);
      expect(matrixResponse.data.valueAxes).toHaveLength(1);
      expect(matrixResponse.data.complexityAxes).toHaveLength(1);
    });
  });

  describe('GET /folders/matrix/default', () => {
    it('should get default matrix config', async () => {
      const response = await apiRequest('/api/v1/folders/matrix/default');
      
      expect(response.ok).toBe(true);
      expect(response.data.valueAxes).toBeDefined();
      expect(response.data.complexityAxes).toBeDefined();
      expect(Array.isArray(response.data.valueAxes)).toBe(true);
      expect(Array.isArray(response.data.complexityAxes)).toBe(true);
    });
  });

  describe('GET /folders/list/with-matrices', () => {
    it('should get folders with matrix data', async () => {
      const response = await apiRequest('/api/v1/folders/list/with-matrices');
      
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.data.items)).toBe(true);
    });
  });

  describe('PUT /folders/:id/matrix', () => {
    it('should update folder matrix config', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then update its matrix
      const newMatrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Updated Value 1', weight: 0.7 },
          { id: 'value2', name: 'Updated Value 2', weight: 0.3 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Updated Complexity 1', weight: 0.6 },
          { id: 'complexity2', name: 'Updated Complexity 2', weight: 0.4 }
        ],
        valueThresholds: [
          { level: 1, points: 15 },
          { level: 2, points: 25 }
        ],
        complexityThresholds: [
          { level: 1, points: 8 },
          { level: 2, points: 18 }
        ]
      };

      const updateResponse = await apiRequest(`/api/v1/folders/${folderId}/matrix`, {
        method: 'PUT',
        body: JSON.stringify(newMatrixConfig),
      });

      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.data.valueAxes).toHaveLength(2);
      expect(updateResponse.data.complexityAxes).toHaveLength(2);
    });

    it('should reject invalid matrix config', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        companyId: await createTestCompany()
      };

      const createResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!createResponse.ok) {
        console.error('Folder creation failed:', createResponse.status, createResponse.error);
        console.error('Response data:', createResponse.data);
      }
      expect(createResponse.ok).toBe(true);
      const folderId = createResponse.data.id;

      // Then try to update with invalid matrix
      const invalidMatrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value 1', weight: 'invalid' } // Invalid weight type
        ],
        complexityAxes: [],
        valueThresholds: [],
        complexityThresholds: []
      };

      const updateResponse = await apiRequest(`/api/v1/folders/${folderId}/matrix`, {
        method: 'PUT',
        body: JSON.stringify(invalidMatrixConfig),
      });

      expect(updateResponse.ok).toBe(false);
      expect(updateResponse.status).toBe(400);
    });
  });
});
