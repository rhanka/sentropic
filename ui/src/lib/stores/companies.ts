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

const API_BASE_URL = 'http://localhost:8787/api/v1';

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
    throw new Error('Failed to delete company');
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
