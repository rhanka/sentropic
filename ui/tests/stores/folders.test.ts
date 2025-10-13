import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  foldersStore, 
  currentFolderId, 
  fetchFolders, 
  createFolder, 
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

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({}, 500);

      await expect(fetchFolders()).rejects.toThrow('Failed to fetch folders');
    });
  });

  describe('createFolder', () => {
    it('should create folder successfully', async () => {
      const newFolder = { name: 'New Folder', companyId: 'company1' };
      const createdFolder = { id: '1', ...newFolder };
      
      mockFetchJsonOnce(createdFolder);

      const result = await createFolder(newFolder);
      
      expect(result).toEqual(createdFolder);
    });
  });

  describe('updateFolder', () => {
    it('should update folder successfully', async () => {
      const updates = { name: 'Updated Folder' };
      const updatedFolder = { id: '1', name: 'Updated Folder', companyId: 'company1' };
      
      mockFetchJsonOnce(updatedFolder);

      const result = await updateFolder('1', updates);
      
      expect(result).toEqual(updatedFolder);
    });
  });

  describe('deleteFolder', () => {
    it('should delete folder successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteFolder('1');
      
    });

    it('should throw error when deletion fails', async () => {
      mockFetchJsonOnce({ message: 'Folder not found' }, 404);

      await expect(deleteFolder('1')).rejects.toThrow('Failed to delete folder');
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(foldersStore)).toEqual([]);
      expect(get(currentFolderId)).toBeNull();
    });

    it('should update folders store', () => {
      const folders = [{ id: '1', name: 'Folder 1', companyId: 'company1' }];
      foldersStore.set(folders);
      expect(get(foldersStore)).toEqual(folders);
    });

    it('should update current folder ID', () => {
      currentFolderId.set('1');
      expect(get(currentFolderId)).toBe('1');
    });
  });
});
