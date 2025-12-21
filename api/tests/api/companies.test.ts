import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';
import { 
  createAuthenticatedUser, 
  createTestUsersWithRoles,
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Companies API', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  // ===== SECURITY TESTS (401 responses) =====
  it('should return 401 without authentication for GET /companies', async () => {
    const res = await unauthenticatedRequest(app, 'GET', '/api/v1/companies');
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for POST /companies', async () => {
    const res = await unauthenticatedRequest(app, 'POST', '/api/v1/companies', {
      name: 'Test Company',
      industry: 'Technology'
    });
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for GET /companies/:id', async () => {
    const res = await unauthenticatedRequest(app, 'GET', '/api/v1/companies/123');
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for PUT /companies/:id', async () => {
    const res = await unauthenticatedRequest(app, 'PUT', '/api/v1/companies/123', {
      name: 'Updated Company'
    });
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for DELETE /companies/:id', async () => {
    const res = await unauthenticatedRequest(app, 'DELETE', '/api/v1/companies/123');
    expect(res.status).toBe(401);
  });

  // ===== PERMISSION TESTS (role-based access) =====
  it('should allow editors to create companies', async () => {
    const user = await createAuthenticatedUser('editor');
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const res = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);
    expect(res.status).toBe(201);
  });

  it('should allow guests to read companies (200)', async () => {
    const user = await createAuthenticatedUser('guest');
    
    const res = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken!);
    expect(res.status).toBe(200);
  });

  // ===== FUNCTIONAL TESTS (with authentication) =====
  it('should create a company with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const res = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe(companyData.name);
    expect(data.industry).toBe(companyData.industry);
  });

  it('should get all companies with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    
    const res = await authenticatedRequest(app, 'GET', '/api/v1/companies', user.sessionToken!);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('should get a specific company with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const companyId = createData.id;

    // Then get it
    const getRes = await authenticatedRequest(app, 'GET', `/api/v1/companies/${companyId}`, user.sessionToken!);
    
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(companyId);
    expect(getData.name).toBe(companyData.name);
  });

  it('should update a company with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const companyId = createData.id;

    // Then update it
    const updateData = {
      name: `Updated Company ${createTestId()}`,
      industry: 'Updated Industry',
    };

    const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/companies/${companyId}`, user.sessionToken!, updateData);
    expect(updateRes.status).toBe(200);
    const updateDataResponse = await updateRes.json();
    expect(updateDataResponse.name).toBe(updateData.name);
    expect(updateDataResponse.industry).toBe(updateData.industry);
  });

  it('should delete a company with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    // First create a company
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testCompanies.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/companies', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const companyId = createData.id;

    // Then delete it
    const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/companies/${companyId}`, user.sessionToken!);
    expect(deleteRes.status).toBe(204);

    // Verify it's deleted
    const getRes = await authenticatedRequest(app, 'GET', `/api/v1/companies/${companyId}`, user.sessionToken!);
    expect(getRes.status).toBe(404);
  });
});
