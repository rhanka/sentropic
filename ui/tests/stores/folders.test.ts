import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  foldersStore, 
  currentFolderId, 
  fetchFolders, 
  createFolder, 
  createDraftFolder,
  updateFolder, 
  deleteFolder
} from '../../src/lib/stores/folders';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';

describe('Folders Store', () => {
  beforeEach(() => {
    resetFetchMock();
    foldersStore.set([]);
    currentFolderId.set(null);
  });

  describe('fetchFolders', () => {
    it('should fetch folders successfully', async () => {
      const mockFolders = [
        { id: '1', name: 'Folder 1', companyId: 'company1' },
        { id: '2', name: 'Folder 2', companyId: 'company2' }
      ];
      
      mockFetchJsonOnce({ items: mockFolders });

      const result = await fetchFolders();
      
      expect(result).toEqual(mockFolders);
    });

    it('should parse executiveSummary correctly when fetching folders', async () => {
      const mockFolders = [
        { 
          id: '1', 
          name: 'Folder 1', 
          companyId: 'company1',
          executiveSummary: {
            introduction: 'Test introduction',
            analyse: 'Test analyse',
            recommandation: 'Test recommandation',
            synthese_executive: 'Test synthese'
          }
        }
      ];
      
      mockFetchJsonOnce({ items: mockFolders });

      const result = await fetchFolders();
      
      expect(result).toEqual(mockFolders);
      expect(result[0].executiveSummary).toBeDefined();
      expect(result[0].executiveSummary?.introduction).toBe('Test introduction');
      expect(typeof result[0].executiveSummary).toBe('object');
    });

    it('should handle null executiveSummary when fetching folders', async () => {
      const mockFolders = [
        { 
          id: '1', 
          name: 'Folder 1', 
          companyId: 'company1',
          executiveSummary: null
        }
      ];
      
      mockFetchJsonOnce({ items: mockFolders });

      const result = await fetchFolders();
      
      expect(result).toEqual(mockFolders);
      expect(result[0].executiveSummary).toBeNull();
    });

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to fetch folders' }, 500);

      await expect(fetchFolders()).rejects.toThrow('Failed to fetch folders');
    });
  });

  describe('createFolder', () => {
    it('should create folder successfully', async () => {
      // Note: backend stores organizationId; keep payload minimal here
      const newFolder = { name: 'New Folder', description: '' };
      const createdFolder = { id: '1', ...newFolder };
      
      mockFetchJsonOnce(createdFolder);

      const result = await createFolder(newFolder);
      
      expect(result).toEqual(createdFolder);
    });
  });

  describe('createDraftFolder', () => {
    it('should create a draft folder successfully', async () => {
      const createdFolder = {
        id: 'draft_1',
        name: 'Brouillon',
        description: 'Contexte',
        organizationId: 'org_1',
        status: 'draft',
        createdAt: new Date().toISOString()
      };

      mockFetchJsonOnce(createdFolder);

      const result = await createDraftFolder({
        name: 'Brouillon',
        description: 'Contexte',
        organizationId: 'org_1'
      });

      expect(result).toEqual(createdFolder);
      expect(result.status).toBe('draft');
    });
  });

  describe('updateFolder', () => {
    it('should update folder successfully', async () => {
      const updates = { name: 'Updated Folder' };
      const updatedFolder = { id: '1', name: 'Updated Folder', description: '', createdAt: new Date().toISOString() };
      
      mockFetchJsonOnce(updatedFolder);

      const result = await updateFolder('1', updates);
      
      expect(result).toEqual(updatedFolder);
    });

    it('should update folder with executiveSummary', async () => {
      const executiveSummary = {
        introduction: 'Test introduction',
        analyse: 'Test analyse',
        recommandation: 'Test recommandation',
        synthese_executive: 'Test synthese',
        references: [
          { title: 'Reference 1', url: 'https://example.com/1' }
        ]
      };
      const updates = { executiveSummary };
      const updatedFolder = { 
        id: '1', 
        name: 'Test Folder', 
        companyId: 'company1',
        executiveSummary 
      };
      
      mockFetchJsonOnce(updatedFolder);

      const result = await updateFolder('1', updates);
      
      expect(result).toEqual(updatedFolder);
      expect(result.executiveSummary).toBeDefined();
      expect(result.executiveSummary?.introduction).toBe('Test introduction');
      expect(result.executiveSummary?.references).toHaveLength(1);
    });
  });

  describe('deleteFolder', () => {
    it('should delete folder successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteFolder('1');
      
    });

    it('should throw error when deletion fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to delete folder' }, 404);

      await expect(deleteFolder('1')).rejects.toThrow('Failed to delete folder');
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(foldersStore)).toEqual([]);
      expect(get(currentFolderId)).toBeNull();
    });

    it('should update folders store', () => {
      const folders = [{ id: '1', name: 'Folder 1', description: '', createdAt: new Date().toISOString() }];
      foldersStore.set(folders);
      expect(get(foldersStore)).toEqual(folders);
    });

    it('should update folders store with executiveSummary', () => {
      const folders = [{ 
        id: '1', 
        name: 'Folder 1', 
        companyId: 'company1',
        executiveSummary: {
          introduction: 'Test',
          synthese_executive: 'Test synthese'
        }
      }];
      foldersStore.set(folders);
      const stored = get(foldersStore);
      expect(stored).toEqual(folders);
      expect(stored[0].executiveSummary).toBeDefined();
    });

    it('should update current folder ID', () => {
      currentFolderId.set('1');
      expect(get(currentFolderId)).toBe('1');
    });
  });
});
