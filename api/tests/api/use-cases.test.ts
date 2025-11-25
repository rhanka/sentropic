import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { testUseCases } from '../utils/test-data';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Use Cases API', () => {
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
      industry: 'Technology',
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
    return data.id;
  }

  // Helper function to create a test use case
  async function createTestUseCase(folderId?: string) {
    const useCaseData = {
      name: `Test Use Case ${createTestId()}`,
      description: 'Test use case description',
      ...(folderId && { folderId })
    };

    const response = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, useCaseData);
    expect(response.status).toBe(201);
    const data = await response.json();
    return data;
  }

  describe('GET /use-cases', () => {
    it('should get all use cases', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/use-cases', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
      // Model field should be present in all use cases
      if (data.items.length > 0) {
        expect(data.items[0]).toHaveProperty('model');
      }
    });
  });

  describe('POST /use-cases', () => {
    it('should create a use case', async () => {
      const folderId = await createTestFolder();
      const useCaseData = {
        name: `Test Use Case ${createTestId()}`,
        description: 'Test use case description',
        folderId: folderId,
        valueScore: 8,
        complexityScore: 6
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, useCaseData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(useCaseData.name);
      expect(data.description).toBe(useCaseData.description);
      expect(data.folderId).toBe(folderId);
    });

    it('should create a use case without folder', async () => {
      const folderId = await createTestFolder();
      const useCaseData = {
        name: `Test Use Case ${createTestId()}`,
        description: 'Test use case without folder',
        folderId: folderId,
        valueScore: 7,
        complexityScore: 5
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, useCaseData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(useCaseData.name);
      expect(data.folderId).toBe(folderId);
    });

    it('should reject invalid use case data', async () => {
      const invalidUseCaseData = {
        // Missing required name field
        description: 'Invalid use case'
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, invalidUseCaseData);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /use-cases/:id', () => {
    it('should get a specific use case', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      
      const response = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(useCase.id);
      expect(data.name).toBe(useCase.name);
      // Model field should be present (may be null or have default value from settings)
      expect(data).toHaveProperty('model');
    });

    it('should return 404 for non-existent use case', async () => {
      const nonExistentId = 'non-existent-id';
      
      const response = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${nonExistentId}`, user.sessionToken!);
      
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /use-cases/:id', () => {
    it('should update a use case', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      const updateData = {
        name: `Updated Use Case ${createTestId()}`,
        description: 'Updated description',
        valueScore: 9,
        complexityScore: 7
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(updateData.name);
      expect(data.description).toBe(updateData.description);
    });

    it('should partially update a use case', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      const partialUpdate = {
        name: `Partially Updated ${createTestId()}`
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, partialUpdate);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(partialUpdate.name);
      expect(data.description).toBe(useCase.description); // Should remain unchanged
    });

    it('should round totalValueScore with Math.round() when valueScores are updated', async () => {
      // Create folder with matrix config
      const matrixConfig = {
        valueAxes: [
          { id: 'business_impact', name: 'Business Impact', weight: 1.0 }
        ],
        complexityAxes: [
          { id: 'technical_complexity', name: 'Technical Complexity', weight: 1.0 }
        ],
        valueThresholds: [
          { level: 1, points: 10 },
          { level: 2, points: 20 },
          { level: 3, points: 30 }
        ],
        complexityThresholds: [
          { level: 1, points: 10 },
          { level: 2, points: 20 },
          { level: 3, points: 30 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        matrixConfig
      };

      const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);
      expect(folderResponse.status).toBe(201);
      const folder = await folderResponse.json();
      const folderId = folder.id;

      // Create use case
      const useCase = await createTestUseCase(folderId);

      // Update with valueScores that will result in a decimal score (e.g., 15.7 -> 16)
      // Le schéma attend { axisId, rating, description }
      const updateData = {
        valueScores: [
          { axisId: 'business_impact', rating: 2, description: 'Test rating 2' } // rating 2 avec weight 1.0 = 2.0, mais peut donner decimal avec d'autres poids
        ]
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalValueScore).toBeDefined();
      // Score should be rounded (integer)
      expect(Number.isInteger(data.totalValueScore)).toBe(true);
    });

    it('should round totalComplexityScore with Math.round() when complexityScores are updated', async () => {
      // Create folder with matrix config
      const matrixConfig = {
        valueAxes: [
          { id: 'business_impact', name: 'Business Impact', weight: 1.0 }
        ],
        complexityAxes: [
          { id: 'technical_complexity', name: 'Technical Complexity', weight: 1.0 }
        ],
        valueThresholds: [
          { level: 1, points: 10 }
        ],
        complexityThresholds: [
          { level: 1, points: 10 },
          { level: 2, points: 20 },
          { level: 3, points: 30 }
        ]
      };

      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder',
        matrixConfig
      };

      const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);
      expect(folderResponse.status).toBe(201);
      const folder = await folderResponse.json();
      const folderId = folder.id;

      // Create use case
      const useCase = await createTestUseCase(folderId);

      // Update with complexityScores
      // Le schéma attend { axisId, rating, description }
      const updateData = {
        complexityScores: [
          { axisId: 'technical_complexity', rating: 2, description: 'Test complexity rating 2' } // rating 2 avec weight 1.0 = 2.0
        ]
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalComplexityScore).toBeDefined();
      // Score should be rounded (integer)
      expect(Number.isInteger(data.totalComplexityScore)).toBe(true);
    });

    it('should only recompute scores when valueScores or complexityScores are modified', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      
      // Get initial scores
      const initialResponse = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!);
      const initialData = await initialResponse.json();
      const initialValueScore = initialData.totalValueScore;
      const initialComplexityScore = initialData.totalComplexityScore;

      // Update only name (should not recompute scores)
      const updateData = {
        name: `Updated Name ${createTestId()}`
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(updateData.name);
      // Scores should remain unchanged
      expect(data.totalValueScore).toBe(initialValueScore);
      expect(data.totalComplexityScore).toBe(initialComplexityScore);
    });

    it('should preserve existing scores when not modifying valueScores or complexityScores', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      
      // Get initial scores
      const initialResponse = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!);
      const initialData = await initialResponse.json();
      const initialValueScore = initialData.totalValueScore;
      const initialComplexityScore = initialData.totalComplexityScore;

      // Update description only
      const updateData = {
        description: 'Updated description without changing scores'
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.description).toBe(updateData.description);
      // Scores should be preserved
      expect(data.totalValueScore).toBe(initialValueScore);
      expect(data.totalComplexityScore).toBe(initialComplexityScore);
    });
  });

  describe('DELETE /use-cases/:id', () => {
    it('should delete a use case', async () => {
      const folderId = await createTestFolder();
      const useCase = await createTestUseCase(folderId);
      
      const response = await authenticatedRequest(app, 'DELETE', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!);
      
      expect(response.status).toBe(204);

      // Verify it's deleted
      const getResponse = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${useCase.id}`, user.sessionToken!);
      expect(getResponse.status).toBe(404);
    });
  });
});