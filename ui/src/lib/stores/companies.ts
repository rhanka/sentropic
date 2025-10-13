import { writable } from 'svelte/store';

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

// Utilise l'URL API injectée par l'env Vite en priorité (docker: http://api:8787)
import { API_BASE_URL } from '$lib/config';

// Fonctions API
export const fetchCompanies = async (): Promise<Company[]> => {
  const response = await fetch(`${API_BASE_URL}/companies`);
  if (!response.ok) {
    throw new Error('Failed to fetch companies');
  }
  const data = await response.json();
  return data.items;
};

export const createCompany = async (company: Omit<Company, 'id'>): Promise<Company> => {
  const response = await fetch(`${API_BASE_URL}/companies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(company),
  });
  if (!response.ok) {
    throw new Error('Failed to create company');
  }
  return response.json();
};

export const updateCompany = async (id: string, company: Partial<Company>): Promise<Company> => {
  const response = await fetch(`${API_BASE_URL}/companies/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(company),
  });
  if (!response.ok) {
    throw new Error('Failed to update company');
  }
  return response.json();
};

export const deleteCompany = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/companies/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    // Gérer spécifiquement l'erreur 409 (Conflict - dependencies exist)
    if (response.status === 409) {
      const errorData = await response.json();
      const details = errorData.details || {};
      const parts = [];
      if (details.folders > 0) parts.push(`${details.folders} dossier(s)`);
      if (details.useCases > 0) parts.push(`${details.useCases} cas d'usage`);
      
      const detailsMessage = parts.length > 0 ? ` (${parts.join(' et ')})` : '';
      throw new Error(`${errorData.message || 'Impossible de supprimer l\'entreprise'}${detailsMessage}`);
    }
    
    // Autres erreurs
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to delete company');
  }
};

export const enrichCompany = async (companyName: string): Promise<CompanyEnrichmentData> => {
  const response = await fetch(`${API_BASE_URL}/companies/ai-enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: companyName }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to enrich company');
  }
  return response.json();
};

export const createDraftCompany = async (name: string): Promise<Company> => {
  const response = await fetch(`${API_BASE_URL}/companies/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to create draft company');
  }
  return response.json();
};

export const startCompanyEnrichment = async (companyId: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/companies/${companyId}/enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to start enrichment');
  }
};
