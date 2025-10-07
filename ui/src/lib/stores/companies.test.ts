import { describe, it, expect, vi, beforeEach } from 'vitest';
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
} from './companies';

// Mock fetch
global.fetch = vi.fn();

describe('Companies Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companiesStore.set([]);
    currentCompanyId.set(null);
  });

  describe('fetchCompanies', () => {
    it('should fetch companies successfully', async () => {
      const mockCompanies = [
        { id: '1', name: 'Company 1' },
        { id: '2', name: 'Company 2' }
      ];
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: mockCompanies })
      });

      const result = await fetchCompanies();
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies');
      expect(result).toEqual(mockCompanies);
    });

    it('should throw error when fetch fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(fetchCompanies()).rejects.toThrow('Failed to fetch companies');
    });
  });

  describe('createCompany', () => {
    it('should create company successfully', async () => {
      const newCompany = { name: 'New Company', industry: 'Tech' };
      const createdCompany = { id: '1', ...newCompany };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createdCompany)
      });

      const result = await createCompany(newCompany);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCompany)
      });
      expect(result).toEqual(createdCompany);
    });

    it('should throw error when creation fails', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(createCompany({ name: 'Test' })).rejects.toThrow('Failed to create company');
    });
  });

  describe('updateCompany', () => {
    it('should update company successfully', async () => {
      const updates = { industry: 'Updated Industry' };
      const updatedCompany = { id: '1', name: 'Company', ...updates };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedCompany)
      });

      const result = await updateCompany('1', updates);
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      expect(result).toEqual(updatedCompany);
    });
  });

  describe('deleteCompany', () => {
    it('should delete company successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await deleteCompany('1');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies/1', {
        method: 'DELETE'
      });
    });

    it('should handle 409 conflict with detailed message', async () => {
      const errorResponse = {
        message: 'Impossible de supprimer l\'entreprise car elle est utilisée',
        details: { folders: 2, useCases: 5 }
      };
      
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve(errorResponse)
      });

      await expect(deleteCompany('1')).rejects.toThrow(
        'Impossible de supprimer l\'entreprise car elle est utilisée (2 dossier(s) et 5 cas d\'usage)'
      );
    });

    it('should handle other errors', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' })
      });

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
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(enrichmentData)
      });

      const result = await enrichCompany('Test Company');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies/ai-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Company' })
      });
      expect(result).toEqual(enrichmentData);
    });
  });

  describe('createDraftCompany', () => {
    it('should create draft company successfully', async () => {
      const draftCompany = { id: '1', name: 'Draft Company', status: 'draft' };
      
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(draftCompany)
      });

      const result = await createDraftCompany('Draft Company');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Draft Company' })
      });
      expect(result).toEqual(draftCompany);
    });
  });

  describe('startCompanyEnrichment', () => {
    it('should start enrichment successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true
      });

      await startCompanyEnrichment('1');
      
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/v1/companies/1/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
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
