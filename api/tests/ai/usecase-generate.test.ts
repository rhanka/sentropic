import { describe, it, expect } from 'vitest';
import { apiRequest, getTestModel, sleep } from '../utils/test-helpers';
import { testUseCases } from '../utils/test-data';

describe('Use Case AI Generation', () => {
  it('should generate use cases with queue', async () => {
    const generateData = {
      input: testUseCases.forGeneration.input,
      create_new_folder: true,
      model: getTestModel(),
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(true);
    expect(response.data.success).toBe(true);
    expect(response.data.status).toBe('generating');
    expect(response.data.created_folder_id).toBeDefined();
    expect(response.data.jobId).toBeDefined();

    const folderId = response.data.created_folder_id;

    // Wait for processing (queue needs more time)
    await sleep(15000);

    // Check if use cases were created
    const useCasesResponse = await apiRequest(`/use-cases?folder_id=${folderId}`);
    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);

    // Cleanup
    if (folderId) {
      // Delete the folder and its use cases
      await apiRequest(`/folders/${folderId}`, { method: 'DELETE' });
    }
  });

  it('should generate use cases for existing folder', async () => {
    // First create a folder
    const folderData = {
      name: `Test Folder ${Date.now()}`,
      description: 'Test folder for use case generation',
    };

    const folderResponse = await apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify(folderData),
    });

    expect(folderResponse.ok).toBe(true);
    const folderId = folderResponse.data.id;

    // Then generate use cases
    const generateData = {
      input: testUseCases.valid.input,
      create_new_folder: false,
      model: getTestModel(),
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(true);
    expect(response.data.success).toBe(true);

    // Cleanup
    await apiRequest(`/folders/${folderId}`, { method: 'DELETE' });
  });

  it('should handle generation errors gracefully', async () => {
    const generateData = {
      input: '', // Invalid input
      create_new_folder: true,
      model: getTestModel(),
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });
});
