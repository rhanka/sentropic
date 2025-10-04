import { writable } from 'svelte/store';

export type UseCase = {
  id: string;
  folderId: string;
  companyId?: string;
  name: string;
  description: string;
  process?: string;
  technology?: string;
  deadline?: string;
  contact?: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  nextSteps: string[];
  sources: string[];
  relatedData: string[];
  valueScores: any[];
  complexityScores: any[];
  totalValueScore: number;
  totalComplexityScore: number;
  status?: 'draft' | 'pending' | 'generating' | 'detailing' | 'completed';
  createdAt: string;
};

export const useCasesStore = writable<UseCase[]>([]);

const API_BASE_URL = 'http://localhost:8787/api/v1';

// Fonctions API
export const fetchUseCases = async (folderId?: string): Promise<UseCase[]> => {
  const url = folderId 
    ? `${API_BASE_URL}/use-cases?folder_id=${folderId}`
    : `${API_BASE_URL}/use-cases`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch use cases');
  }
  const data = await response.json();
  return data.items;
};

export const generateUseCases = async (input: string, createNewFolder: boolean, companyId?: string): Promise<{created_folder_id?: string; created_use_case_ids: string[]; summary: string}> => {
  const response = await fetch(`${API_BASE_URL}/use-cases/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input,
      create_new_folder: createNewFolder,
      company_id: companyId
    }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to generate use cases');
  }
  return response.json();
};

export const createUseCase = async (useCase: Omit<UseCase, 'id' | 'createdAt'>): Promise<UseCase> => {
  const response = await fetch(`${API_BASE_URL}/use-cases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(useCase),
  });
  if (!response.ok) {
    throw new Error('Failed to create use case');
  }
  return response.json();
};

export const updateUseCase = async (id: string, useCase: Partial<UseCase>): Promise<UseCase> => {
  const response = await fetch(`${API_BASE_URL}/use-cases/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(useCase),
  });
  if (!response.ok) {
    throw new Error('Failed to update use case');
  }
  return response.json();
};

export const deleteUseCase = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/use-cases/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete use case');
  }
};

export const detailUseCase = async (id: string, model?: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/use-cases/${id}/detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to detail use case');
  }
};