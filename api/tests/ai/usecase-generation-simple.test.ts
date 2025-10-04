import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId } from '../utils/test-helpers';
import { testUseCases } from '../utils/test-data';

describe('Use Case Generation - Simple', () => {
  let createdCompanyId: string | null = null;
  let createdFolderId: string | null = null;

  afterEach(async () => {
    // Cleanup
    if (createdFolderId) {
      await apiRequest(`/folders/${createdFolderId}`, { method: 'DELETE' });
      createdFolderId = null;
    }
    if (createdCompanyId) {
      await apiRequest(`/companies/${createdCompanyId}`, { method: 'DELETE' });
      createdCompanyId = null;
    }
  });

  it('should create a company draft for use case generation', async () => {
    const companyName = `Test Company UC ${createTestId()}`;

    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    expect(draftResponse.data.name).toBe(companyName);
    expect(draftResponse.data.status).toBe('draft');
    
    createdCompanyId = draftResponse.data.id;
  });

  it('should start use case generation with new folder', async () => {
    const generateData = {
      input: testUseCases.forGeneration.input,
      create_new_folder: true,
      model: 'gpt-4o',
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(true);
    expect(response.data.created_folder_id).toBeDefined();
    expect(response.data.jobId).toBeDefined();

    createdFolderId = response.data.created_folder_id;

    // Verify folder was created
    const folderResponse = await apiRequest(`/folders/${createdFolderId}`);
    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.status).toBe('generating');
  });

  it('should start use case generation with company context', async () => {
    // Create a company draft
    const companyName = `Test Company Context ${createTestId()}`;
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Start enrichment
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o' }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);

    // Generate use cases with company context
    const generateData = {
      input: `Générer des cas d'usage d'IA pour ${companyName}`,
      create_new_folder: true,
      company_id: createdCompanyId,
      model: 'gpt-4o',
    };

    const generateResponse = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(generateResponse.ok).toBe(true);
    expect(generateResponse.data.created_folder_id).toBeDefined();
    expect(generateResponse.data.jobId).toBeDefined();

    createdFolderId = generateResponse.data.created_folder_id;

    // Verify folder was created with company association
    const folderResponse = await apiRequest(`/folders/${createdFolderId}`);
    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.companyId).toBe(createdCompanyId);
    expect(folderResponse.data.status).toBe('generating');
  });

  it('should start use case generation for existing folder', async () => {
    // Create a folder first
    const folderData = {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for use case generation',
    };

    const folderResponse = await apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify(folderData),
    });

    expect(folderResponse.ok).toBe(true);
    createdFolderId = folderResponse.data.id;

    // Generate use cases in existing folder
    const generateData = {
      input: testUseCases.valid.input,
      create_new_folder: false,
      model: 'gpt-4o',
    };

    const generateResponse = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(generateResponse.ok).toBe(true);
    expect(generateResponse.data.jobId).toBeDefined();
  });

  it('should handle generation errors gracefully', async () => {
    const generateData = {
      input: '', // Invalid input
      create_new_folder: true,
      model: 'gpt-4o',
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });

  it('should handle invalid company ID in generation', async () => {
    const generateData = {
      input: testUseCases.forGeneration.input,
      create_new_folder: true,
      company_id: 'invalid-company-id',
      model: 'gpt-4o',
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    // The API should handle invalid company ID gracefully
    // It might return an error or ignore the invalid ID
    if (response.ok) {
      expect(response.data.created_folder_id).toBeDefined();
    } else {
      // If it returns an error, that's also acceptable behavior
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});
