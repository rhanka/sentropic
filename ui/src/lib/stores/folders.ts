import { writable } from 'svelte/store';

export type Folder = {
  id: string;
  name: string;
  description: string;
  companyId?: string;
  companyName?: string;
  matrixConfig?: any;
  status?: 'generating' | 'completed';
  createdAt: string;
};

export const foldersStore = writable<Folder[]>([]);
export const currentFolderId = writable<string | null>(null);

import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';

// Fonctions API
export const fetchFolders = async (): Promise<Folder[]> => {
  const data = await apiGet<{ items: Folder[] }>('/folders');
  return data.items;
};

export const createFolder = async (folder: Omit<Folder, 'id' | 'createdAt'>): Promise<Folder> => {
  return apiPost<Folder>('/folders', folder);
};

export const updateFolder = async (id: string, folder: Partial<Folder>): Promise<Folder> => {
  return apiPut<Folder>(`/folders/${id}`, folder);
};

export const deleteFolder = async (id: string): Promise<void> => {
  await apiDelete(`/folders/${id}`);
};