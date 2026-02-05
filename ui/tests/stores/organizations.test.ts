import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  organizationsStore,
  currentOrganizationId,
  fetchOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  enrichOrganization,
  createDraftOrganization,
  startOrganizationEnrichment,
  organizationExportState,
  openOrganizationExport,
  closeOrganizationExport,
} from '../../src/lib/stores/organizations';
import { resetFetchMock, mockFetchJsonOnce } from '../../tests/test-setup';

describe('Organizations Store', () => {
  beforeEach(() => {
    resetFetchMock();
    organizationsStore.set([]);
    currentOrganizationId.set(null);
  });

  describe('fetchOrganizations', () => {
    it('should fetch organizations successfully', async () => {
      const mockOrganizations = [
        { id: '1', name: 'Organization 1' },
        { id: '2', name: 'Organization 2' }
      ];

      mockFetchJsonOnce({ items: mockOrganizations });

      const result = await fetchOrganizations();
      expect(result).toEqual(mockOrganizations);
    });

    it('should throw error when fetch fails', async () => {
      mockFetchJsonOnce({ error: 'Failed to fetch organizations' }, 500);

      await expect(fetchOrganizations()).rejects.toThrow('Failed to fetch organizations');
    });
  });

  describe('createOrganization', () => {
    it('should create organization successfully', async () => {
      const newOrganization = { name: 'New Organization', industry: 'Tech' };
      const createdOrganization = { id: '1', ...newOrganization };

      mockFetchJsonOnce(createdOrganization);

      const result = await createOrganization(newOrganization as any);
      expect(result).toEqual(createdOrganization);
    });

    it('should throw error when creation fails', async () => {
      mockFetchJsonOnce({ error: "Failed to create organization" }, 500);

      await expect(createOrganization({ name: 'Test' } as any)).rejects.toThrow('Failed to create organization');
    });
  });

  describe('updateOrganization', () => {
    it('should update organization successfully', async () => {
      const updates = { industry: 'Updated Industry' };
      const updatedOrganization = { id: '1', name: 'Organization', ...updates };

      mockFetchJsonOnce(updatedOrganization);

      const result = await updateOrganization('1', updates);
      expect(result).toEqual(updatedOrganization);
    });
  });

  describe('deleteOrganization', () => {
    it('should delete organization successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteOrganization('1');
    });

    it('should handle 409 conflict with detailed message', async () => {
      const errorResponse = {
        message: "Impossible de supprimer l'organisation",
        details: { folders: 2, useCases: 5 }
      };

      // Simule une erreur 409
      mockFetchJsonOnce(errorResponse, 409);

      await expect(deleteOrganization('1')).rejects.toThrow(
        "Impossible de supprimer l'organisation (2 dossier(s) et 5 cas d'usage)"
      );
    });

    it('should handle other errors', async () => {
      mockFetchJsonOnce({ message: 'Server error' }, 500);

      await expect(deleteOrganization('1')).rejects.toThrow('Server error');
    });
  });

  describe('enrichOrganization', () => {
    it('should enrich organization successfully', async () => {
      const enrichmentData = {
        normalizedName: 'Test Organization',
        industry: 'Technology',
        size: 'Large'
      };

      mockFetchJsonOnce(enrichmentData);

      const result = await enrichOrganization('Test Organization');
      expect(result).toEqual(enrichmentData);
    });
  });

  describe('createDraftOrganization', () => {
    it('should create draft organization successfully', async () => {
      const draftOrganization = { id: '1', name: 'Draft Organization', status: 'draft' };

      mockFetchJsonOnce(draftOrganization);

      const result = await createDraftOrganization('Draft Organization');
      expect(result).toEqual(draftOrganization);
    });
  });

  describe('startOrganizationEnrichment', () => {
    it('should start enrichment successfully', async () => {
      mockFetchJsonOnce({}, 200);

      await startOrganizationEnrichment('1');
    });
  });

  describe('stores', () => {
    it('should initialize with empty values', () => {
      expect(get(organizationsStore)).toEqual([]);
      expect(get(currentOrganizationId)).toBeNull();
    });

    it('should update organizations store', () => {
      const organizations = [{ id: '1', name: 'Organization 1' }];
      organizationsStore.set(organizations as any);
      expect(get(organizationsStore)).toEqual(organizations);
    });

    it('should update current organization ID', () => {
      currentOrganizationId.set('1');
      expect(get(currentOrganizationId)).toBe('1');
    });

    it('opens and closes organization export state', () => {
      expect(get(organizationExportState)).toEqual({ open: false, organizationId: null });

      openOrganizationExport('org-1');
      expect(get(organizationExportState)).toEqual({ open: true, organizationId: 'org-1' });

      closeOrganizationExport();
      expect(get(organizationExportState)).toEqual({ open: false, organizationId: null });
    });
  });
});


