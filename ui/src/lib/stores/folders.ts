import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Folder = {
  id: string;
  name: string;
  description: string;
  organizationId?: string | null;
  organizationName?: string | null;
  matrixConfig?: any;
  hasMatrix?: boolean; // Indicates if folder has a matrix configuration
  executiveSummary?: {
    introduction?: string;
    analyse?: string;
    recommandation?: string;
    synthese_executive?: string;
    references?: Array<{ title: string; url: string }>;
  } | null;
  status?: 'generating' | 'completed';
  createdAt: string;
};

export const foldersStore = writable<Folder[]>([]);

// Persistent store for currentFolderId
const STORAGE_KEY = 'currentFolderId';

function createPersistentFolderIdStore() {
  // Initialize from localStorage if available
  const initialValue = browser 
    ? (localStorage.getItem(STORAGE_KEY) || null)
    : null;

  const { subscribe, set, update } = writable<string | null>(initialValue);

  return {
    subscribe,
    set: (value: string | null) => {
      if (browser) {
        if (value) {
          localStorage.setItem(STORAGE_KEY, value);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      set(value);
    },
    update: (updater: (value: string | null) => string | null) => {
      update(current => {
        const newValue = updater(current);
        if (browser) {
          if (newValue) {
            localStorage.setItem(STORAGE_KEY, newValue);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
        return newValue;
      });
    }
  };
}

export const currentFolderId = createPersistentFolderIdStore();

import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';
import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';

// Fonctions API
export const fetchFolders = async (): Promise<Folder[]> => {
  const scoped = getScopedWorkspaceIdForAdmin();
  const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
  const data = await apiGet<{ items: Folder[] }>(`/folders${qs}`);
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