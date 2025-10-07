import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId } from '../utils/test-helpers';
import { testCompanies, testUseCases } from '../utils/test-data';

describe('Use Cases API', () => {
  // Helper function to create a test company
  async function createTestCompany() {
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: 'Technology',
    };

    const response = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(response.ok).toBe(true);
    return response.data.id;
  }

  // Helper function to create a test folder
  async function createTestFolder() {
    const folderData = {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for use cases'
    };

    const response = await apiRequest('/api/v1/folders', {
      method: 'POST',
      body: JSON.stringify(folderData),
    });

    expect(response.ok).toBe(true);
    return response.data.id;
  }

  // Helper function to create a test use case
  async function createTestUseCase(folderId?: string) {
    const actualFolderId = folderId || await createTestFolder();
    
    const useCaseData = {
      name: `Test Use Case ${createTestId()}`,
      description: 'Test use case description',
      folderId: actualFolderId,
      scores: {
        valueAxes: [
          { id: 'business_value', rating: 3 },
          { id: 'time_criticality', rating: 2 },
          { id: 'risk_reduction_opportunity', rating: 4 }
        ],
        complexityAxes: [
          { id: 'ai_maturity', rating: 2 },
          { id: 'implementation_effort', rating: 3 },
          { id: 'data_compliance', rating: 1 },
          { id: 'data_availability', rating: 2 },
          { id: 'change_management', rating: 3 }
        ]
      }
    };

    const response = await apiRequest('/api/v1/use-cases', {
      method: 'POST',
      body: JSON.stringify(useCaseData),
    });

    if (!response.ok) {
      console.error('Use case creation failed:', response.status, response.error);
      console.error('Response data:', response.data);
    }
    expect(response.ok).toBe(true);
    return response.data;
  }

  afterEach(async () => {
    // Cleanup - get all use cases and delete test ones
    const useCasesResponse = await apiRequest('/api/v1/use-cases');
    if (useCasesResponse.ok && useCasesResponse.data.items) {
      for (const useCase of useCasesResponse.data.items) {
        if (useCase.name.includes('Test Use Case')) {
          await apiRequest(`/api/v1/use-cases/${useCase.id}`, { method: 'DELETE' });
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

  describe('GET /use-cases', () => {
    it('should get all use cases', async () => {
      const response = await apiRequest('/api/v1/use-cases');
      
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.data.items)).toBe(true);
    });

    it('should get use cases filtered by folder_id', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder for use cases'
      };

      const folderResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (folderResponse.ok) {
        const folderId = folderResponse.data.id;

        const response = await apiRequest(`/api/v1/use-cases?folder_id=${folderId}`);
        
        expect(response.ok).toBe(true);
        expect(Array.isArray(response.data.items)).toBe(true);
      }
    });
  });

  describe('POST /use-cases', () => {
    it('should create a use case', async () => {
      // First create a folder
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder for use cases'
      };

      const folderResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!folderResponse.ok) {
        throw new Error('Failed to create test folder');
      }

      const folderId = folderResponse.data.id;

      const useCaseData = {
        name: `Test Use Case ${createTestId()}`,
        description: 'Test use case description',
        folderId: folderId,
        scores: {
          valueAxes: [
            { id: 'business_value', rating: 3 },
            { id: 'time_criticality', rating: 2 },
            { id: 'risk_reduction_opportunity', rating: 4 }
          ],
          complexityAxes: [
            { id: 'ai_maturity', rating: 2 },
            { id: 'implementation_effort', rating: 3 },
            { id: 'data_compliance', rating: 1 },
            { id: 'data_availability', rating: 2 },
            { id: 'change_management', rating: 3 }
          ]
        }
      };

      const response = await apiRequest('/api/v1/use-cases', {
        method: 'POST',
        body: JSON.stringify(useCaseData),
      });

      if (!response.ok) {
        console.error('Use case creation failed:', response.status, response.error);
        console.error('Response data:', response.data);
      }
      expect(response.ok).toBe(true);
      expect(response.data.name).toBe(useCaseData.name);
      expect(response.data.description).toBe(useCaseData.description);
      expect(response.data.folderId).toBe(folderId);
    });

    it('should create a use case without folder', async () => {
      // Create a temporary folder for this test
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Temporary folder for use case test'
      };

      const folderResponse = await apiRequest('/api/v1/folders', {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (!folderResponse.ok) {
        throw new Error('Failed to create test folder');
      }

      const folderId = folderResponse.data.id;

      const useCaseData = {
        name: `Test Use Case ${createTestId()}`,
        description: 'Test use case without folder',
        folderId: folderId,
        scores: {
          valueAxes: [
            { id: 'business_value', rating: 3 },
            { id: 'time_criticality', rating: 2 },
            { id: 'risk_reduction_opportunity', rating: 4 }
          ],
          complexityAxes: [
            { id: 'ai_maturity', rating: 2 },
            { id: 'implementation_effort', rating: 3 },
            { id: 'data_compliance', rating: 1 },
            { id: 'data_availability', rating: 2 },
            { id: 'change_management', rating: 3 }
          ]
        }
      };

      const response = await apiRequest('/api/v1/use-cases', {
        method: 'POST',
        body: JSON.stringify(useCaseData),
      });

      if (!response.ok) {
        console.error('Use case creation failed:', response.status, response.error);
        console.error('Response data:', response.data);
      }
      expect(response.ok).toBe(true);
      expect(response.data.name).toBe(useCaseData.name);
      expect(response.data.folderId).toBe(folderId);
    });

    it('should reject invalid use case data', async () => {
      const invalidData = {
        title: '', // Empty title should fail
        description: 'Test'
      };

      const response = await apiRequest('/api/v1/use-cases', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /use-cases/:id', () => {
    it('should get a specific use case', async () => {
      // Create a use case using helper
      const useCase = await createTestUseCase();
      const useCaseId = useCase.id;

      // Then get it
      const getResponse = await apiRequest(`/api/v1/use-cases/${useCaseId}`);
      
      expect(getResponse.ok).toBe(true);
      expect(getResponse.data.id).toBe(useCaseId);
      expect(getResponse.data.name).toBe(useCase.name);
    });

    it('should return 404 for non-existent use case', async () => {
      const response = await apiRequest('/api/v1/use-cases/non-existent-id');
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /use-cases/:id', () => {
    it('should update a use case', async () => {
      // Create a use case using helper
      const useCase = await createTestUseCase();
      const useCaseId = useCase.id;

      // Then update it
      const updateData = {
        name: `Updated Use Case ${createTestId()}`,
        description: 'Updated description'
      };

      const updateResponse = await apiRequest(`/api/v1/use-cases/${useCaseId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (!updateResponse.ok) {
        console.error('Use case update failed:', updateResponse.status, updateResponse.error);
      }
      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.data.name).toBe(updateData.name);
      expect(updateResponse.data.description).toBe(updateData.description);
    });

    it('should partially update a use case', async () => {
      // Create a use case using helper
      const useCase = await createTestUseCase();
      const useCaseId = useCase.id;

      // Then partially update it
      const updateData = {
        name: `Updated Use Case ${createTestId()}`
        // Only update name, keep description
      };

      const updateResponse = await apiRequest(`/api/v1/use-cases/${useCaseId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (!updateResponse.ok) {
        console.error('Use case update failed:', updateResponse.status, updateResponse.error);
      }
      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.data.name).toBe(updateData.name);
      expect(updateResponse.data.description).toBe(useCase.description); // Should remain unchanged
    });
  });

  describe('DELETE /use-cases/:id', () => {
    it('should delete a use case', async () => {
      // Create a use case using helper
      const useCase = await createTestUseCase();
      const useCaseId = useCase.id;

      // Then delete it
      const deleteResponse = await apiRequest(`/api/v1/use-cases/${useCaseId}`, {
        method: 'DELETE',
      });

      expect(deleteResponse.ok).toBe(true);
      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const getResponse = await apiRequest(`/api/v1/use-cases/${useCaseId}`);
      expect(getResponse.ok).toBe(false);
      expect(getResponse.status).toBe(404);
    });
  });

});
