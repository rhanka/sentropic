import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { 
  companiesStore, 
  currentCompanyId, 
  fetchCompanies, 
  createCompany, 
  updateCompany, 
  deleteCompany,
  enrichCompany,
  createDraftCompany,
  startCompanyEnrichment
} from '../../src/lib/stores/companies';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';

describe('Companies Store', () => {
  beforeEach(() => {
    resetFetchMock();
    companiesStore.set([]);
    currentCompanyId.set(null);
  });

  describe('fetchCompanies', () => {
    it('should fetch companies successfully', async () => {
      const mockCompanies = [
        { id: '1', name: 'Company 1' },
        { id: '2', name: 'Company 2' }
      ];
      
      mockFetchJsonOnce({ items: mockCompanies });

      const result = await fetchCompanies();
      expect(result).toEqual(mockCompanies);
    });

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to fetch companies' }, 500);

      await expect(fetchCompanies()).rejects.toThrow('Failed to fetch companies');
    });
  });

  describe('createCompany', () => {
    it('should create company successfully', async () => {
      const newCompany = { name: 'New Company', industry: 'Tech' };
      const createdCompany = { id: '1', ...newCompany };
      
      mockFetchJsonOnce({ item: createdCompany });

      const result = await createCompany(newCompany);
      expect(result).toEqual(createdCompany);
    });

    it('should throw error when creation fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to create company' }, 500);

      await expect(createCompany({ name: 'Test' })).rejects.toThrow('Failed to create company');
    });
  });

  describe('updateCompany', () => {
    it('should update company successfully', async () => {
      const updates = { industry: 'Updated Industry' };
      const updatedCompany = { id: '1', name: 'Company', ...updates };
      
      mockFetchJsonOnce({ item: updatedCompany });

      const result = await updateCompany('1', updates);
      expect(result).toEqual(updatedCompany);
    });
  });

  describe('deleteCompany', () => {
    it('should delete company successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteCompany('1');
    });

    it('should handle 409 conflict with detailed message', async () => {
      const errorResponse = {
        error: 'Impossible de supprimer l\'entreprise car elle est utilisée (2 dossier(s) et 5 cas d\'usage)'
      };
      
      // Simule une erreur 409
      mockFetchJsonOnce(errorResponse, 409);

      await expect(deleteCompany('1')).rejects.toThrow(
        'Impossible de supprimer l\'entreprise car elle est utilisée (2 dossier(s) et 5 cas d\'usage)'
      );
    });

    it('should handle other errors', async () => {
      mockFetchJsonOnce({ error: 'Server error' }, 500);

      await expect(deleteCompany('1')).rejects.toThrow('Server error');
    });
  });

  describe('enrichCompany', () => {
    it('should enrich company successfully', async () => {
      const enrichmentData = {
        normalizedName: 'Test Company',
        industry: 'Technology',
        size: 'Large'
      };
      
      mockFetchJsonOnce(enrichmentData);

      const result = await enrichCompany('Test Company');
      expect(result).toEqual(enrichmentData);
    });
  });

  describe('createDraftCompany', () => {
    it('should create draft company successfully', async () => {
      const draftCompany = { id: '1', name: 'Draft Company', status: 'draft' };
      
      mockFetchJsonOnce(draftCompany);

      const result = await createDraftCompany('Draft Company');
      expect(result).toEqual(draftCompany);
    });
  });

  describe('startCompanyEnrichment', () => {
    it('should start enrichment successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await startCompanyEnrichment('1');
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(companiesStore)).toEqual([]);
      expect(get(currentCompanyId)).toBeNull();
    });

    it('should update companies store', () => {
      const companies = [{ id: '1', name: 'Company 1' }];
      companiesStore.set(companies);
      expect(get(companiesStore)).toEqual(companies);
    });

    it('should update current company ID', () => {
      currentCompanyId.set('1');
      expect(get(currentCompanyId)).toBe('1');
    });
  });
});
