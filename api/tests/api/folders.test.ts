import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { testOrganizations } from '../utils/test-data';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { workspaceMemberships } from '../../src/db/schema';

describe('Folders API', () => {
  let user: any;
  let viewer: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    viewer = await createAuthenticatedUser('guest');
    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: viewer.id, role: 'viewer', createdAt: new Date() })
        .onConflictDoNothing();
    }
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  // Helper function to create a test organization
  async function createTestOrganization() {
    const orgData = {
      name: `Test Organization ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const response = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, orgData);
    expect(response.status).toBe(201);
    const data = await response.json();
    return data.id;
  }

  // Helper function to create a test folder
  async function createTestFolder(organizationId?: string) {
    const folderData = {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder description',
      ...(organizationId && { organizationId })
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

    it('should get folders filtered by organization_id', async () => {
      const organizationId = await createTestOrganization();
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders?organization_id=${organizationId}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe('POST /folders', () => {
    it('should create a folder', async () => {
      const organizationId = await createTestOrganization();
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description',
        organizationId: organizationId
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(folderData.name);
      expect(data.description).toBe(folderData.description);
      expect(data.organizationId).toBe(organizationId);
    });

    it('should create a folder without organization', async () => {
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder without organization'
      };

      const response = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, folderData);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe(folderData.name);
      expect(data.organizationId).toBeNull();
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

    it('should forbid viewers from creating folders', async () => {
      const folderData = {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder description'
      };

      const response = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/folders?workspace_id=${encodeURIComponent(user.workspaceId)}`,
        viewer.sessionToken!,
        folderData
      );
      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /folders/:id', () => {
    it('should forbid viewers from deleting folders', async () => {
      const folder = await createTestFolder();

      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/folders/${folder.id}?workspace_id=${encodeURIComponent(user.workspaceId)}`,
        viewer.sessionToken!
      );
      expect(response.status).toBe(403);
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

    it('should return executiveSummary as parsed JSON object', async () => {
      const folder = await createTestFolder();
      
      // Set executiveSummary via PUT
      const executiveSummary = {
        introduction: 'Test introduction',
        analyse: 'Test analyse',
        recommandation: 'Test recommandation',
        synthese_executive: 'Test synthese'
      };

      await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, {
        executiveSummary
      });

      // Get folder and verify executiveSummary is parsed
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.executiveSummary).toBeDefined();
      expect(typeof data.executiveSummary).toBe('object');
      expect(Array.isArray(data.executiveSummary)).toBe(false); // Should be object, not array
      expect(data.executiveSummary.introduction).toBe(executiveSummary.introduction);
      expect(data.executiveSummary.analyse).toBe(executiveSummary.analyse);
    });

    it('should return null executiveSummary when not set', async () => {
      const folder = await createTestFolder();
      
      const response = await authenticatedRequest(app, 'GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.executiveSummary).toBeNull();
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

    it('should update folder with executiveSummary', async () => {
      const folder = await createTestFolder();
      const executiveSummary = {
        introduction: 'Test introduction',
        analyse: 'Test analyse',
        recommandation: 'Test recommandation',
        synthese_executive: 'Test synthese',
        references: [
          { title: 'Reference 1', url: 'https://example.com/1' },
          { title: 'Reference 2', url: 'https://example.com/2' }
        ]
      };

      const updateData = {
        executiveSummary
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.executiveSummary).toBeDefined();
      expect(data.executiveSummary.introduction).toBe(executiveSummary.introduction);
      expect(data.executiveSummary.analyse).toBe(executiveSummary.analyse);
      expect(data.executiveSummary.recommandation).toBe(executiveSummary.recommandation);
      expect(data.executiveSummary.synthese_executive).toBe(executiveSummary.synthese_executive);
      expect(data.executiveSummary.references).toBeDefined();
      expect(data.executiveSummary.references).toHaveLength(2);
      expect(data.executiveSummary.references[0].title).toBe('Reference 1');
    });

    it('should partially update executiveSummary (single section)', async () => {
      const folder = await createTestFolder();
      
      // First, create a full executiveSummary
      const fullExecutiveSummary = {
        introduction: 'Original introduction',
        analyse: 'Original analyse',
        recommandation: 'Original recommandation',
        synthese_executive: 'Original synthese'
      };

      await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, {
        executiveSummary: fullExecutiveSummary
      });

      // Then update only one section
      const partialUpdate = {
        executiveSummary: {
          introduction: 'Updated introduction'
        }
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, partialUpdate);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.executiveSummary).toBeDefined();
      expect(data.executiveSummary.introduction).toBe('Updated introduction');
      // Other sections should remain (though API might not preserve them if not sent - depends on implementation)
    });

    it('should reject invalid executiveSummary structure', async () => {
      const folder = await createTestFolder();
      // Zod avec .optional() accepte les objets avec champs supplémentaires si tous les champs valides sont optionnels
      // Testons plutôt avec un type invalide (array au lieu d'object)
      const invalidExecutiveSummary = ['invalid', 'array'];

      const updateData = {
        executiveSummary: invalidExecutiveSummary
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, updateData);
      
      expect(response.status).toBe(400);
    });

    it('should allow empty executiveSummary object', async () => {
      const folder = await createTestFolder();
      
      // First, create an executiveSummary
      await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, {
        executiveSummary: {
          introduction: 'Test'
        }
      });

      // Zod .optional() n'accepte pas null, seulement undefined
      // Pour "vider" le champ, on peut envoyer un objet vide (tous les champs sont optionnels)
      const updateDataEmpty = {
        executiveSummary: {}
      };

      const response = await authenticatedRequest(app, 'PUT', `/api/v1/folders/${folder.id}`, user.sessionToken!, updateDataEmpty);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      // Un objet vide devrait être accepté (tous les champs sont optionnels)
      expect(data.executiveSummary).toBeDefined();
      expect(typeof data.executiveSummary).toBe('object');
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