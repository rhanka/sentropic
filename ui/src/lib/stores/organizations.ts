import { writable } from 'svelte/store';
import { ApiError } from '$lib/utils/api';
import { apiDelete, apiGet, apiPost, apiPut } from '$lib/utils/api';
import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';

export type Organization = {
  id: string;
  name: string;
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
  kpis?: string;
  references?: Array<{ title: string; url: string; excerpt?: string }>;
  status?: 'draft' | 'enriching' | 'completed';
};

export type OrganizationEnrichmentData = {
  normalizedName: string;
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
};

export const organizationsStore = writable<Organization[]>([]);
export const currentOrganizationId = writable<string | null>(null);

export const fetchOrganizations = async (): Promise<Organization[]> => {
  const scoped = getScopedWorkspaceIdForAdmin();
  const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
  const data = await apiGet<{ items: Organization[] }>(`/organizations${qs}`);
  return data.items;
};

export const fetchOrganizationById = async (id: string): Promise<Organization> => {
  const scoped = getScopedWorkspaceIdForAdmin();
  const qs = scoped ? `?workspace_id=${encodeURIComponent(scoped)}` : '';
  return await apiGet<Organization>(`/organizations/${id}${qs}`);
};

export const createOrganization = async (organization: Omit<Organization, 'id'>): Promise<Organization> => {
  return await apiPost<Organization>('/organizations', organization);
};

export const updateOrganization = async (id: string, organization: Partial<Organization>): Promise<Organization> => {
  return await apiPut<Organization>(`/organizations/${id}`, organization);
};

export const deleteOrganization = async (id: string): Promise<void> => {
  try {
    await apiDelete(`/organizations/${id}`);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 409 && error.data && (error.data as any)?.details) {
      const details = (error.data as any).details as { folders?: number; useCases?: number };
      const folders = details.folders || 0;
      const useCases = details.useCases || 0;
      throw new Error(`Impossible de supprimer l'organisation (${folders} dossier(s) et ${useCases} cas d'usage)`);
    }
    throw error;
  }
};

export const enrichOrganization = async (organizationName: string): Promise<OrganizationEnrichmentData> => {
  return apiPost<OrganizationEnrichmentData>('/organizations/ai-enrich', { name: organizationName });
};

export const createDraftOrganization = async (name: string): Promise<Organization> => {
  return apiPost<Organization>('/organizations/draft', { name });
};

export const startOrganizationEnrichment = async (organizationId: string): Promise<void> => {
  await apiPost(`/organizations/${organizationId}/enrich`);
};


