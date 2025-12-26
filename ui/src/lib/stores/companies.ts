// Backward-compatible store: "companies" maps to "organizations".
// Keep this file to avoid breaking many imports while UI routes are migrated.
export {
  organizationsStore as companiesStore,
  currentOrganizationId as currentCompanyId,
  fetchOrganizations as fetchCompanies,
  fetchOrganizationById as fetchCompanyById,
  createOrganization as createCompany,
  updateOrganization as updateCompany,
  deleteOrganization as deleteCompany,
  enrichOrganization as enrichCompany,
  createDraftOrganization as createDraftCompany,
  startOrganizationEnrichment as startCompanyEnrichment,
} from './organizations';

export type { Organization as Company, OrganizationEnrichmentData as CompanyEnrichmentData } from './organizations';
