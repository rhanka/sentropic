import { writable } from 'svelte/store';

export type InitiativeData = {
  name: string;
  description?: string;
  problem?: string;
  solution?: string;
  domain?: string;
  technologies?: string[];
  deadline?: string;
  contact?: string;
  benefits?: string[];
  metrics?: string[];
  risks?: string[];
  constraints?: string[];
  nextSteps?: string[];
  dataSources?: string[];
  dataObjects?: string[];
  references?: Array<{title: string; url: string}>;
  valueScores?: any[];
  complexityScores?: any[];
};

export type Initiative = {
  id: string;
  folderId: string;
  organizationId?: string | null;
  status?: 'draft' | 'generating' | 'detailing' | 'completed';
  model?: string; // Model used for generation (e.g., 'gpt-5', 'gpt-4.1-nano')
  createdAt: string;
  data: InitiativeData;
  totalValueScore?: number | null;
  totalComplexityScore?: number | null;
  // Backward compatibility: keep direct properties for legacy code
  name?: string;
  description?: string;
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

/** @deprecated Use Initiative */
export type UseCase = Initiative;
/** @deprecated Use InitiativeData */
export type UseCaseData = InitiativeData;

export const initiativesStore = writable<Initiative[]>([]);
/** @deprecated Use initiativesStore */
export const useCasesStore = initiativesStore;

export type InitiativeExportState = { open: boolean; initiativeId: string | null };
export const initiativeExportState = writable<InitiativeExportState>({ open: false, initiativeId: null });

export const openInitiativeExport = (initiativeId: string) => {
  initiativeExportState.set({ open: true, initiativeId });
};

export const closeInitiativeExport = () => {
  initiativeExportState.set({ open: false, initiativeId: null });
};

/** @deprecated Use initiativeExportState */
export const useCaseExportState = initiativeExportState;
/** @deprecated Use openInitiativeExport */
export const openUseCaseExport = openInitiativeExport;
/** @deprecated Use closeInitiativeExport */
export const closeUseCaseExport = closeInitiativeExport;

import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';

// API functions
export const fetchInitiatives = async (folderId?: string): Promise<Initiative[]> => {
  const qsFolder = folderId ? `folder_id=${encodeURIComponent(folderId)}` : '';
  const qs = [qsFolder].filter(Boolean).join('&');
  const url = qs ? `/use-cases?${qs}` : '/use-cases';

  const data = await apiGet<{ items: Initiative[] }>(url);
  return data.items;
};

export const generateInitiatives = async (
  input: string,
  organizationId?: string,
  folderId?: string,
  initiativeCount?: number
): Promise<{ created_folder_id?: string; created_use_case_ids: string[]; summary: string }> => {
  return apiPost('/use-cases/generate', {
    input,
    organization_id: organizationId,
    folder_id: folderId,
    use_case_count: initiativeCount
  });
};

export const createInitiative = async (initiative: Omit<Initiative, 'id' | 'createdAt'>): Promise<Initiative> => {
  return apiPost<Initiative>('/use-cases', initiative);
};

export const updateInitiative = async (id: string, initiative: Partial<Initiative>): Promise<Initiative> => {
  return apiPut<Initiative>(`/use-cases/${id}`, initiative);
};

export const deleteInitiative = async (id: string): Promise<void> => {
  await apiDelete(`/use-cases/${id}`);
};

export const detailInitiative = async (id: string, model?: string): Promise<void> => {
  await apiPost(`/use-cases/${id}/detail`, { model });
};

/** @deprecated Use fetchInitiatives */
export const fetchUseCases = fetchInitiatives;
/** @deprecated Use generateInitiatives */
export const generateUseCases = generateInitiatives;
/** @deprecated Use createInitiative */
export const createUseCase = createInitiative;
/** @deprecated Use updateInitiative */
export const updateUseCase = updateInitiative;
/** @deprecated Use deleteInitiative */
export const deleteUseCase = deleteInitiative;
/** @deprecated Use detailInitiative */
export const detailUseCase = detailInitiative;
