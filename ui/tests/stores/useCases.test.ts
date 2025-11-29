import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  useCasesStore, 
  fetchUseCases, 
  createUseCase, 
  updateUseCase, 
  deleteUseCase,
  generateUseCases,
  detailUseCase
} from '../../src/lib/stores/useCases';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';

describe('Use Cases Store', () => {
  beforeEach(() => {
    resetFetchMock();
    useCasesStore.set([]);
  });

  describe('fetchUseCases', () => {
    it('should fetch use cases successfully', async () => {
      const mockUseCases = [
        { id: '1', folderId: 'folder1', companyId: 'company1', model: 'gpt-4.1-nano', data: { name: 'Use Case 1' } },
        { id: '2', folderId: 'folder1', companyId: 'company1', model: 'gpt-4.1-nano', data: { name: 'Use Case 2' } }
      ];
      
      mockFetchJsonOnce({ items: mockUseCases });

      const result = await fetchUseCases();
      
      expect(result).toEqual(mockUseCases);
    });

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to fetch use cases' }, 500);

      await expect(fetchUseCases()).rejects.toThrow('Failed to fetch use cases');
    });
  });

  describe('createUseCase', () => {
    it('should create use case successfully', async () => {
      const newUseCase = { 
        name: 'New Use Case', 
        folderId: 'folder1', 
        companyId: 'company1' 
      };
      const createdUseCase = { id: '1', folderId: 'folder1', companyId: 'company1', data: { name: 'New Use Case' } };
      
      mockFetchJsonOnce(createdUseCase);

      const result = await createUseCase(newUseCase);
      
      expect(result).toEqual(createdUseCase);
    });
  });

  describe('updateUseCase', () => {
    it('should update use case successfully', async () => {
      const updates = { name: 'Updated Use Case' };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1', 
        companyId: 'company1',
        data: { name: 'Updated Use Case' }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.name).toBe(updates.name);
    });

    it('should update use case with markdown description', async () => {
      const updates = { description: '**Bold** text with [reference](url)' };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1',
        data: { name: 'Use Case 1', description: updates.description }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.description).toBe(updates.description);
    });

    it('should update use case with problem and solution', async () => {
      const updates = { 
        problem: 'Test problem description',
        solution: 'Test solution description'
      };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1',
        data: { name: 'Use Case 1', problem: updates.problem, solution: updates.solution }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.problem).toBe(updates.problem);
      expect(result.data?.solution).toBe(updates.solution);
    });

    it('should update use case with simple text fields (contact, deadline)', async () => {
      const updates = { 
        contact: 'contact@example.com',
        deadline: 'Q1 2024'
      };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1',
        data: { name: 'Use Case 1', contact: updates.contact, deadline: updates.deadline }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.contact).toBe(updates.contact);
      expect(result.data?.deadline).toBe(updates.deadline);
    });

    it('should update use case with list fields (benefits, risks, metrics, nextSteps)', async () => {
      const updates = { 
        benefits: ['Benefit 1', 'Benefit 2'],
        risks: ['Risk 1'],
        metrics: ['Metric 1', 'Metric 2'],
        nextSteps: ['Step 1']
      };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1',
        data: { name: 'Use Case 1', ...updates }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.benefits).toEqual(updates.benefits);
      expect(result.data?.risks).toEqual(updates.risks);
      expect(result.data?.metrics).toEqual(updates.metrics);
      expect(result.data?.nextSteps).toEqual(updates.nextSteps);
    });

    it('should update use case with icon list fields (dataSources, dataObjects, technologies)', async () => {
      const updates = { 
        dataSources: ['Source 1', 'Source 2'],
        dataObjects: ['Object 1'],
        technologies: ['Technology Stack']
      };
      const updatedUseCase = { 
        id: '1', 
        folderId: 'folder1',
        data: { name: 'Use Case 1', ...updates }
      };
      
      mockFetchJsonOnce(updatedUseCase);

      const result = await updateUseCase('1', updates);
      
      expect(result.data?.dataSources).toEqual(updates.dataSources);
      expect(result.data?.dataObjects).toEqual(updates.dataObjects);
      expect(result.data?.technologies).toEqual(updates.technologies);
    });
  });

  describe('deleteUseCase', () => {
    it('should delete use case successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteUseCase('1');
      
    });

    it('should throw error when deletion fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to delete use case' }, 404);

      await expect(deleteUseCase('1')).rejects.toThrow('Failed to delete use case');
    });
  });

  describe('generateUseCases', () => {
    it('hould generate use cases successfully', async () => {
      const generationResult = {
        created_folder_id: 'folder1',
        created_use_case_ids: ['1', '2'],
        summary: 'Generated 2 use cases'
      };
      
      mockFetchJsonOnce(generationResult);

      const result = await generateUseCases('Test input', true, 'company1');
      
      expect(result).toEqual(generationResult);
    });
  });

  describe('detailUseCase', () => {
    it('should detail use case successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await detailUseCase('1', 'gpt-4');
      
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(useCasesStore)).toEqual([]);
    });

    it('should update use cases store', () => {
      const useCases = [{ 
        id: '1', 
        folderId: 'folder1', 
        companyId: 'company1',
        model: 'gpt-4.1-nano',
        createdAt: '2023-01-01',
        data: {
          name: 'Use Case 1',
          description: 'Test description',
          benefits: [],
          metrics: [],
          risks: [],
          nextSteps: [],
          dataSources: [],
          dataObjects: [],
          valueScores: [],
          complexityScores: []
        },
        // Scores are calculated dynamically, not stored
        totalValueScore: 0,
        totalComplexityScore: 0
      }];
      useCasesStore.set(useCases);
      expect(get(useCasesStore)).toEqual(useCases);
    });
  });
});
