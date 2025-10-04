import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId, sleep } from '../utils/test-helpers';
import { testUseCases, testCompanies } from '../utils/test-data';

describe('Use Case Generation with Company', () => {
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

  it('should generate use cases for a company with new folder', async () => {
    // 1. Create and enrich a company
    const companyName = `Test Company Use Cases ${createTestId()}`;

    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Enrich the company
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5' }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);

    // Wait for enrichment
    await sleep(30000);

    // Verify company is enriched
    const companyResponse = await apiRequest(`/companies/${createdCompanyId}`);
    expect(companyResponse.ok).toBe(true);
    expect(companyResponse.data.status).toBe('completed');
    expect(companyResponse.data.industry).toBeDefined();

    // 2. Generate use cases with company context
    const generateData = {
      input: `Générer des cas d'usage d'IA pour ${companyName} dans le secteur ${companyResponse.data.industry}`,
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

    // 3. Wait for use case generation
    await sleep(35000);

    // 4. Verify folder was created with company association
    const folderResponse = await apiRequest(`/folders/${createdFolderId}`);
    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.companyId).toBe(createdCompanyId);
    expect(folderResponse.data.status).toBe('completed');

    // 5. Verify use cases were created
    const useCasesResponse = await apiRequest(`/use-cases?folder_id=${createdFolderId}`);
    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);

    // 6. Verify use cases have company context
    const useCases = useCasesResponse.data.items;
    const firstUseCase = useCases[0];
    expect(firstUseCase.companyId).toBe(createdCompanyId);
    expect(firstUseCase.folderId).toBe(createdFolderId);
    expect(firstUseCase.name).toBeDefined();
    expect(firstUseCase.name).not.toBe('[Object Object]');
  }, 80000);

  it('should generate use cases for existing folder with company', async () => {
    // 1. Create and enrich a company
    const companyName = `Test Company Existing Folder ${createTestId()}`;

    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Enrich the company
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5' }),
    });

    expect(enrichResponse.ok).toBe(true);

    // Wait for enrichment
    await sleep(30000);

    // 2. Create a folder associated with the company
    const folderData = {
      name: `Test Folder for ${companyName}`,
      description: `Dossier de test pour ${companyName}`,
      companyId: createdCompanyId,
    };

    const folderResponse = await apiRequest('/folders', {
      method: 'POST',
      body: JSON.stringify(folderData),
    });

    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.companyId).toBe(createdCompanyId);
    createdFolderId = folderResponse.data.id;

    // 3. Generate use cases in the existing folder
    const generateData = {
      input: `Générer des cas d'usage d'IA pour optimiser les processus de ${companyName}`,
      create_new_folder: false,
      company_id: createdCompanyId,
      model: 'gpt-4o',
    };

    const generateResponse = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(generateResponse.ok).toBe(true);
    expect(generateResponse.data.jobId).toBeDefined();

    // 4. Wait for use case generation
    await sleep(35000);

    // 5. Verify use cases were created in the existing folder
    const useCasesResponse = await apiRequest(`/use-cases?folder_id=${createdFolderId}`);
    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);

    // 6. Verify all use cases are associated with the company
    const useCases = useCasesResponse.data.items;
    useCases.forEach((useCase: any) => {
      expect(useCase.companyId).toBe(createdCompanyId);
      expect(useCase.folderId).toBe(createdFolderId);
      expect(useCase.name).toBeDefined();
      expect(useCase.name).not.toBe('[Object Object]');
    });
  }, 80000);

  it('should handle generation without company context', async () => {
    // Generate use cases without company_id (should still work)
    const generateData = {
      input: testUseCases.forGeneration.input,
      create_new_folder: true,
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

    // Wait for generation
    await sleep(35000);

    // Verify folder was created without company association
    const folderResponse = await apiRequest(`/folders/${createdFolderId}`);
    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.companyId).toBeNull();

    // Verify use cases were created
    const useCasesResponse = await apiRequest(`/use-cases?folder_id=${createdFolderId}`);
    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);

    // Verify use cases don't have company association
    const useCases = useCasesResponse.data.items;
    useCases.forEach((useCase: any) => {
      expect(useCase.companyId).toBeNull();
      expect(useCase.folderId).toBe(createdFolderId);
    });
  }, 50000);
});
