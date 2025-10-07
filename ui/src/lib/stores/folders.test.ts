import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  foldersStore, 
  currentFolderId, 
  fetchFolders, 
  createFolder, 
  updateFolder, 
  deleteFolder
} from './folders';

// Mock fetch
global.fetch = vi.fn();

describe('Folders Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    foldersStore.set([]);
    currentFolderId.set(null);
  });

  describe('fetchFolders', () => {
    it('should fetch folders successfully', async () => {
      const mockFolders = [
        { id: '1', name: 'Folder 1', companyId: 'company1' },
        { id: '2', name: 'Folder 2', companyId: 'company2' }
      ];
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: mockFolders })
      });

      const result = await fetchFolders();
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/folders');
      expect(result).toEqual(mockFolders);
    });

    it('should throw error when fetch fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(fetchFolders()).rejects.toThrow('Failed to fetch folders');
    });
  });

  describe('createFolder', () => {
    it('should create folder successfully', async () => {
      const newFolder = { name: 'New Folder', companyId: 'company1' };
      const createdFolder = { id: '1', ...newFolder };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createdFolder)
      });

      const result = await createFolder(newFolder);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFolder)
      });
      expect(result).toEqual(createdFolder);
    });
  });

  describe('updateFolder', () => {
    it('should update folder successfully', async () => {
      const updates = { name: 'Updated Folder' };
      const updatedFolder = { id: '1', name: 'Updated Folder', companyId: 'company1' };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedFolder)
      });

      const result = await updateFolder('1', updates);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/folders/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      expect(result).toEqual(updatedFolder);
    });
  });

  describe('deleteFolder', () => {
    it('should delete folder successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await deleteFolder('1');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/folders/1', {
        method: 'DELETE'
      });
    });

    it('should throw error when deletion fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Folder not found' })
      });

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
