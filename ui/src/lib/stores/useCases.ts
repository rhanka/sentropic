import { writable } from 'svelte/store';

export type UseCaseData = {
  name: string;
  description?: string;
  problem?: string;
  solution?: string;
  process?: string;
  domain?: string;
  technologies?: string[];
  prerequisites?: string;
  deadline?: string;
  contact?: string;
  benefits?: string[];
  metrics?: string[];
  risks?: string[];
  nextSteps?: string[];
  dataSources?: string[];
  dataObjects?: string[];
  references?: Array<{title: string; url: string}>;
  valueScores?: any[];
  complexityScores?: any[];
};

export type UseCase = {
  id: string;
  folderId: string;
  organizationId?: string | null;
  status?: 'draft' | 'generating' | 'detailing' | 'completed';
  model?: string; // Model used for generation (e.g., 'gpt-5', 'gpt-4.1-nano')
  createdAt: string;
  data: UseCaseData;
  totalValueScore?: number | null;
  totalComplexityScore?: number | null;
  // Rétrocompatibilité : garder les propriétés directes pour l'ancien code
  name?: string;
  description?: string;
  process?: string;
  technology?: string;
  deadline?: string;
  contact?: string;
  benefits?: string[];
  metrics?: string[];
  risks?: string[];
  nextSteps?: string[];
  dataSources?: string[];
  dataObjects?: string[];
  valueScores?: any[];
  complexityScores?: any[];
  references?: Array<{title: string; url: string}>;
};

export const useCasesStore = writable<UseCase[]>([]);

import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';
import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';

// Fonctions API
export const fetchUseCases = async (folderId?: string): Promise<UseCase[]> => {
  const scoped = getScopedWorkspaceIdForAdmin();
  const qsScope = scoped ? `workspace_id=${encodeURIComponent(scoped)}` : '';
  const qsFolder = folderId ? `folder_id=${encodeURIComponent(folderId)}` : '';
  const qs = [qsFolder, qsScope].filter(Boolean).join('&');
  const url = qs ? `/use-cases?${qs}` : '/use-cases';
  
  const data = await apiGet<{ items: UseCase[] }>(url);
  return data.items;
};

export const generateUseCases = async (
  input: string,
  organizationId?: string,
  folderId?: string,
  useCaseCount?: number
): Promise<{ created_folder_id?: string; created_use_case_ids: string[]; summary: string }> => {
  return apiPost('/use-cases/generate', {
    input,
    organization_id: organizationId,
    folder_id: folderId,
    use_case_count: useCaseCount
  });
};

export const createUseCase = async (useCase: Omit<UseCase, 'id' | 'createdAt'>): Promise<UseCase> => {
  return apiPost<UseCase>('/use-cases', useCase);
};

export const updateUseCase = async (id: string, useCase: Partial<UseCase>): Promise<UseCase> => {
  return apiPut<UseCase>(`/use-cases/${id}`, useCase);
};

export const deleteUseCase = async (id: string): Promise<void> => {
  await apiDelete(`/use-cases/${id}`);
};

export const detailUseCase = async (id: string, model?: string): Promise<void> => {
  await apiPost(`/use-cases/${id}/detail`, { model });
};