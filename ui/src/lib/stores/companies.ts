import { writable } from 'svelte/store';
import { ApiError } from '$lib/utils/api';

export type Company = {
  id: string;
  name: string;
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
  status?: 'draft' | 'enriching' | 'completed';
};

export type CompanyEnrichmentData = {
  normalizedName: string;
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
};

export const companiesStore = writable<Company[]>([]);
export const currentCompanyId = writable<string | null>(null);

import { apiGet, apiPost, apiPut, apiDelete } from '$lib/utils/api';

// Fonctions API
export const fetchCompanies = async (): Promise<Company[]> => {
  const data = await apiGet<{ items: Company[] }>('/companies');
  return data.items;
};

export const fetchCompanyById = async (id: string): Promise<Company> => {
  return await apiGet<Company>(`/companies/${id}`);
};

export const createCompany = async (company: Omit<Company, 'id'>): Promise<Company> => {
  return await apiPost<Company>('/companies', company);
};

export const updateCompany = async (id: string, company: Partial<Company>): Promise<Company> => {
  return await apiPut<Company>(`/companies/${id}`, company);
};

export const deleteCompany = async (id: string): Promise<void> => {
  try {
    await apiDelete(`/companies/${id}`);
  } catch (error: any) {
    // Gérer spécifiquement l'erreur 409 (Conflict - dependencies exist)
    if (error instanceof ApiError && error.status === 409 && error.data?.details) {
      const folders = error.data.details.folders || 0;
      const useCases = error.data.details.useCases || 0;
      throw new Error(`Impossible de supprimer l'entreprise (${folders} dossier(s) et ${useCases} cas d'usage)`);
    }
    throw error;
  }
};

export const enrichCompany = async (companyName: string): Promise<CompanyEnrichmentData> => {
  return apiPost<CompanyEnrichmentData>('/companies/ai-enrich', { name: companyName });
};

export const createDraftCompany = async (name: string): Promise<Company> => {
  return apiPost<Company>('/companies/draft', { name });
};

export const startCompanyEnrichment = async (companyId: string): Promise<void> => {
  await apiPost(`/companies/${companyId}/enrich`);
};
