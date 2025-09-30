import { writable } from 'svelte/store';
export type UseCaseScore = {
  axisId: string;
  rating: number;
  description?: string;
};

export type UseCase = {
  id: string;
  folderId: string;
  companyId?: string;
  name: string;
  description?: string;
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
  valueScores: UseCaseScore[];
  complexityScores: UseCaseScore[];
  totalValueScore?: number | null;
  totalComplexityScore?: number | null;
};

export const useCasesStore = writable<UseCase[]>([]);
