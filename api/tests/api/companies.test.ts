import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiRequest, createTestId } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';

describe('Companies API', () => {
  afterEach(async () => {
    // Cleanup - get all companies and delete test ones
    const response = await apiRequest('/api/v1/companies');
    if (response.ok && response.data.items) {
      for (const company of response.data.items) {
        if (company.name.includes('Test Company')) {
          await apiRequest(`/api/v1/companies/${company.id}`, { method: 'DELETE' });
        }
      }
    }
  });

  it('should create a company', async () => {
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const response = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    if (!response.ok) {
      console.error('Company creation failed:', response.status, response.error);
    }
    expect(response.ok).toBe(true);
    expect(response.data.name).toBe(companyData.name);
    expect(response.data.industry).toBe(companyData.industry);
  });

  it('should get all companies', async () => {
    const response = await apiRequest('/api/v1/companies');
    
    expect(response.ok).toBe(true);
    expect(Array.isArray(response.data.items)).toBe(true);
  });

  it('should get a specific company', async () => {
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createResponse = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(createResponse.ok).toBe(true);
    const companyId = createResponse.data.id;

    // Then get it
    const getResponse = await apiRequest(`/api/v1/companies/${companyId}`);
    
    expect(getResponse.ok).toBe(true);
    expect(getResponse.data.id).toBe(companyId);
    expect(getResponse.data.name).toBe(companyData.name);
  });

  it('should update a company', async () => {
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createResponse = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(createResponse.ok).toBe(true);
    const companyId = createResponse.data.id;

    // Then update it
    const updateData = {
      name: `Updated Company ${createTestId()}`,
      industry: 'Updated Industry',
    };

    const updateResponse = await apiRequest(`/api/v1/companies/${companyId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });

    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.data.name).toBe(updateData.name);
    expect(updateResponse.data.industry).toBe(updateData.industry);
  });

  it('should delete a company', async () => {
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createResponse = await apiRequest('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(createResponse.ok).toBe(true);
    const companyId = createResponse.data.id;

    // Then delete it
    const deleteResponse = await apiRequest(`/api/v1/companies/${companyId}`, {
      method: 'DELETE',
    });

    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.status).toBe(204);

    // Verify it's deleted
    const getResponse = await apiRequest(`/api/v1/companies/${companyId}`);
    expect(getResponse.ok).toBe(false);
    expect(getResponse.status).toBe(404);
  });
});
