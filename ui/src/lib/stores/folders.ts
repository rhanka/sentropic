import { writable } from 'svelte/store';

export type Folder = {
  id: string;
  name: string;
  description: string;
  companyId?: string;
  matrixConfig?: any;
  createdAt: string;
};

export const foldersStore = writable<Folder[]>([]);
export const currentFolderId = writable<string | null>(null);

const API_BASE_URL = 'http://localhost:8787/api/v1';

// Fonctions API
export const fetchFolders = async (): Promise<Folder[]> => {
  const response = await fetch(`${API_BASE_URL}/folders`);
  if (!response.ok) {
    throw new Error('Failed to fetch folders');
  }
  const data = await response.json();
  return data.items;
};

export const createFolder = async (folder: Omit<Folder, 'id' | 'createdAt'>): Promise<Folder> => {
  const response = await fetch(`${API_BASE_URL}/folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(folder),
  });
  if (!response.ok) {
    throw new Error('Failed to create folder');
  }
  return response.json();
};

export const updateFolder = async (id: string, folder: Partial<Folder>): Promise<Folder> => {
  const response = await fetch(`${API_BASE_URL}/folders/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(folder),
  });
  if (!response.ok) {
    throw new Error('Failed to update folder');
  }
  return response.json();
};

export const deleteFolder = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/folders/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete folder');
  }
};