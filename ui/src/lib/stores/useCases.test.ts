import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  useCasesStore, 
  fetchUseCases, 
  createUseCase, 
  updateUseCase, 
  deleteUseCase,
  generateUseCases,
  detailUseCase
} from './useCases';

// Mock fetch
global.fetch = vi.fn();

describe('Use Cases Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCasesStore.set([]);
  });

  describe('fetchUseCases', () => {
    it('should fetch use cases successfully', async () => {
      const mockUseCases = [
        { id: '1', name: 'Use Case 1', folderId: 'folder1', companyId: 'company1' },
        { id: '2', name: 'Use Case 2', folderId: 'folder1', companyId: 'company1' }
      ];
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: mockUseCases })
      });

      const result = await fetchUseCases();
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases');
      expect(result).toEqual(mockUseCases);
    });

    it('should throw error when fetch fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false
      });

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
      const createdUseCase = { id: '1', ...newUseCase };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createdUseCase)
      });

      const result = await createUseCase(newUseCase);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUseCase)
      });
      expect(result).toEqual(createdUseCase);
    });
  });

  describe('updateUseCase', () => {
    it('should update use case successfully', async () => {
      const updates = { name: 'Updated Use Case' };
      const updatedUseCase = { 
        id: '1', 
        name: 'Updated Use Case', 
        folderId: 'folder1', 
        companyId: 'company1' 
      };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedUseCase)
      });

      const result = await updateUseCase('1', updates);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      expect(result).toEqual(updatedUseCase);
    });
  });

  describe('deleteUseCase', () => {
    it('should delete use case successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await deleteUseCase('1');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases/1', {
        method: 'DELETE'
      });
    });

    it('should throw error when deletion fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Use case not found' })
      });

      await expect(deleteUseCase('1')).rejects.toThrow('Failed to delete use case');
    });
  });

  describe('generateUseCases', () => {
    it('should generate use cases successfully', async () => {
      const generationResult = {
        created_folder_id: 'folder1',
        created_use_case_ids: ['1', '2'],
        summary: 'Generated 2 use cases'
      };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(generationResult)
      });

      const result = await generateUseCases('Test input', true, 'company1');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'Test input',
          create_new_folder: true,
          company_id: 'company1'
        })
      });
      expect(result).toEqual(generationResult);
    });
  });

  describe('detailUseCase', () => {
    it('should detail use case successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await detailUseCase('1', 'gpt-4');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/use-cases/1/detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4' })
      });
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(useCasesStore)).toEqual([]);
    });

    it('should update use cases store', () => {
      const useCases = [{ 
        id: '1', 
        name: 'Use Case 1', 
        folderId: 'folder1', 
        companyId: 'company1',
        description: 'Test description',
        benefits: [],
        metrics: [],
        risks: [],
        nextSteps: [],
        dataSources: [],
        dataObjects: [],
        valueScores: [],
        complexityScores: [],
        totalValueScore: 0,
        totalComplexityScore: 0,
        createdAt: '2023-01-01'
      }];
      useCasesStore.set(useCases);
      expect(get(useCasesStore)).toEqual(useCases);
    });
  });
});
