import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Folder = {
  id: string;
  name: string;
  description: string;
  model?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  matrixConfig?: any;
  hasMatrix?: boolean; // Indicates if folder has a matrix configuration
  useCaseCount?: number;
  executiveSummary?: {
    introduction?: string;
    analyse?: string;
    recommandation?: string;
    synthese_executive?: string;
    references?: Array<{ title: string; url: string }>;
  } | null;
  status?: 'draft' | 'generating' | 'completed';
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

// Fonctions API
export const fetchFolders = async (options?: {
  organizationId?: string;
  includeUseCaseCounts?: boolean;
}): Promise<Folder[]> => {
  const params = new URLSearchParams();
  if (options?.organizationId) {
    params.set('organization_id', options.organizationId);
  }
  if (options?.includeUseCaseCounts) {
    params.set('include_usecase_counts', 'true');
  }
  const qs = params.toString();
  const url = qs ? `/folders?${qs}` : '/folders';
  const data = await apiGet<{ items: Folder[] }>(url);
  return data.items;
};

export const createFolder = async (folder: Omit<Folder, 'id' | 'createdAt'>): Promise<Folder> => {
  return apiPost<Folder>('/folders', folder);
};

export const createDraftFolder = async (payload: {
  name: string;
  description?: string;
  organizationId?: string | null;
}): Promise<Folder> => {
  return apiPost<Folder>('/folders/draft', {
    name: payload.name,
    description: payload.description,
    organizationId: payload.organizationId || undefined,
  });
};

export const updateFolder = async (id: string, folder: Partial<Folder>): Promise<Folder> => {
  return apiPut<Folder>(`/folders/${id}`, folder);
};

export const deleteFolder = async (id: string): Promise<void> => {
  await apiDelete(`/folders/${id}`);
};