import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  initiativesStore,
  fetchInitiatives,
  createInitiative,
  updateInitiative,
  deleteInitiative,
  generateInitiatives,
  detailInitiative,
  initiativeExportState,
  openInitiativeExport,
  closeInitiativeExport,
} from '../../src/lib/stores/initiatives';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';

describe('Initiatives Store', () => {
  beforeEach(() => {
    resetFetchMock();
    initiativesStore.set([]);
  });

  describe('fetchInitiatives', () => {
    it('should fetch initiatives successfully', async () => {
      const mockInitiatives = [
        { id: '1', folderId: 'folder1', companyId: 'company1', model: 'gpt-4.1-nano', data: { name: 'Initiative 1' } },
        { id: '2', folderId: 'folder1', companyId: 'company1', model: 'gpt-4.1-nano', data: { name: 'Initiative 2' } }
      ];

      mockFetchJsonOnce({ items: mockInitiatives });

      const result = await fetchInitiatives();

      expect(result).toEqual(mockInitiatives);
    });

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to fetch initiatives' }, 500);

      await expect(fetchInitiatives()).rejects.toThrow('Failed to fetch initiatives');
    });
  });

  describe('createInitiative', () => {
    it('should create initiative successfully', async () => {
      const newInitiative = {
        name: 'New Initiative',
        folderId: 'folder1',
        companyId: 'company1'
      };
      const createdInitiative = { id: '1', folderId: 'folder1', companyId: 'company1', data: { name: 'New Initiative' } };

      mockFetchJsonOnce(createdInitiative);

      const result = await createInitiative(newInitiative);

      expect(result).toEqual(createdInitiative);
    });
  });

  describe('updateInitiative', () => {
    it('should update initiative successfully', async () => {
      const updates = { name: 'Updated Initiative' };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        companyId: 'company1',
        data: { name: 'Updated Initiative' }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.name).toBe(updates.name);
    });

    it('should update initiative with markdown description', async () => {
      const updates = { description: '**Bold** text with [reference](url)' };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        data: { name: 'Initiative 1', description: updates.description }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.description).toBe(updates.description);
    });

    it('should update initiative with problem and solution', async () => {
      const updates = {
        problem: 'Test problem description',
        solution: 'Test solution description'
      };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        data: { name: 'Initiative 1', problem: updates.problem, solution: updates.solution }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.problem).toBe(updates.problem);
      expect(result.data?.solution).toBe(updates.solution);
    });

    it('should update initiative with simple text fields (contact, deadline)', async () => {
      const updates = {
        contact: 'contact@example.com',
        deadline: 'Q1 2024'
      };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        data: { name: 'Initiative 1', contact: updates.contact, deadline: updates.deadline }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.contact).toBe(updates.contact);
      expect(result.data?.deadline).toBe(updates.deadline);
    });

    it('should update initiative with list fields (benefits, risks, metrics, nextSteps)', async () => {
      const updates = {
        benefits: ['Benefit 1', 'Benefit 2'],
        risks: ['Risk 1'],
        metrics: ['Metric 1', 'Metric 2'],
        nextSteps: ['Step 1']
      };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        data: { name: 'Initiative 1', ...updates }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.benefits).toEqual(updates.benefits);
      expect(result.data?.risks).toEqual(updates.risks);
      expect(result.data?.metrics).toEqual(updates.metrics);
      expect(result.data?.nextSteps).toEqual(updates.nextSteps);
    });

    it('should update initiative with icon list fields (dataSources, dataObjects, technologies)', async () => {
      const updates = {
        dataSources: ['Source 1', 'Source 2'],
        dataObjects: ['Object 1'],
        technologies: ['Technology Stack']
      };
      const updatedInitiative = {
        id: '1',
        folderId: 'folder1',
        data: { name: 'Initiative 1', ...updates }
      };

      mockFetchJsonOnce(updatedInitiative);

      const result = await updateInitiative('1', updates);

      expect(result.data?.dataSources).toEqual(updates.dataSources);
      expect(result.data?.dataObjects).toEqual(updates.dataObjects);
      expect(result.data?.technologies).toEqual(updates.technologies);
    });
  });

  describe('deleteInitiative', () => {
    it('should delete initiative successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteInitiative('1');

    });

    it('should throw error when deletion fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to delete initiative' }, 404);

      await expect(deleteInitiative('1')).rejects.toThrow('Failed to delete initiative');
    });
  });

  describe('generateInitiatives', () => {
    it('should generate initiatives successfully', async () => {
      const generationResult = {
        created_folder_id: 'folder1',
        created_use_case_ids: ['1', '2'],
        summary: 'Generated 2 initiatives'
      };

      mockFetchJsonOnce(generationResult);

      const result = await generateInitiatives('Test input', 'company1');

      expect(result).toEqual(generationResult);
    });
  });

  describe('detailInitiative', () => {
    it('should detail initiative successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await detailInitiative('1', 'gpt-4');

    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(initiativesStore)).toEqual([]);
    });

    it('should update initiatives store', () => {
      const initiatives = [{
        id: '1',
        folderId: 'folder1',
        companyId: 'company1',
        model: 'gpt-4.1-nano',
        createdAt: '2023-01-01',
        data: {
          name: 'Initiative 1',
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
      initiativesStore.set(initiatives);
      expect(get(initiativesStore)).toEqual(initiatives);
    });

    it('opens and closes initiative export state', () => {
      expect(get(initiativeExportState)).toEqual({ open: false, initiativeId: null });

      openInitiativeExport('init-1');
      expect(get(initiativeExportState)).toEqual({ open: true, initiativeId: 'init-1' });

      closeInitiativeExport();
      expect(get(initiativeExportState)).toEqual({ open: false, initiativeId: null });
    });
  });
});
