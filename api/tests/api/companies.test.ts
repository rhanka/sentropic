import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { testOrganizations } from '../utils/test-data';
import { 
  createAuthenticatedUser, 
  createTestUsersWithRoles,
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Organizations API', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  // ===== SECURITY TESTS (401 responses) =====
  it('should return 401 without authentication for GET /organizations', async () => {
    const res = await unauthenticatedRequest(app, 'GET', '/api/v1/organizations');
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for POST /organizations', async () => {
    const res = await unauthenticatedRequest(app, 'POST', '/api/v1/organizations', {
      name: 'Test Company',
      industry: 'Technology'
    });
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for GET /organizations/:id', async () => {
    const res = await unauthenticatedRequest(app, 'GET', '/api/v1/organizations/123');
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for PUT /organizations/:id', async () => {
    const res = await unauthenticatedRequest(app, 'PUT', '/api/v1/organizations/123', {
      name: 'Updated Company'
    });
    expect(res.status).toBe(401);
  });

  it('should return 401 without authentication for DELETE /organizations/:id', async () => {
    const res = await unauthenticatedRequest(app, 'DELETE', '/api/v1/organizations/123');
    expect(res.status).toBe(401);
  });

  // ===== PERMISSION TESTS (role-based access) =====
  it('should allow editors to create organizations', async () => {
    const user = await createAuthenticatedUser('editor');
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const res = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, companyData);
    expect(res.status).toBe(201);
  });

  it('should allow guests to read organizations (200)', async () => {
    const user = await createAuthenticatedUser('guest');
    
    const res = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken!);
    expect(res.status).toBe(200);
  });

  it('should isolate organizations by workspace (no cross-tenant access, even for admin_app by default)', async () => {
    const suffix = createTestId();
    const userA = await createAuthenticatedUser('editor', `editor-a-${suffix}@example.com`);
    const userB = await createAuthenticatedUser('editor', `editor-b-${suffix}@example.com`);
    const admin = await createAuthenticatedUser('admin_app', `admin-${suffix}@example.com`);

    // Create organization in userA workspace
    const companyData = {
      name: `Tenant Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', userA.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // userB cannot access userA organization
    const getB = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${created.id}`, userB.sessionToken!);
    expect(getB.status).toBe(404);

    // admin_app cannot access userA organization unless explicit sharing is implemented for that resource
    const getAdmin = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${created.id}`, admin.sessionToken!);
    expect(getAdmin.status).toBe(404);
  });

  // ===== FUNCTIONAL TESTS (with authentication) =====
  it('should create an organization with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const res = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, companyData);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe(companyData.name);
    expect(data.industry).toBe(companyData.industry);
  });

  it('should get all organizations with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    
    const res = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken!);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('should get a specific organization with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    
    // First create an organization
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const organizationId = createData.id;

    // Then get it
    const getRes = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${organizationId}`, user.sessionToken!);
    
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(organizationId);
    expect(getData.name).toBe(companyData.name);
  });

  it('should update an organization with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    // First create an organization
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const organizationId = createData.id;

    // Then update it
    const updateData = {
      name: `Updated Company ${createTestId()}`,
      industry: 'Updated Industry',
    };

    const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/organizations/${organizationId}`, user.sessionToken!, updateData);
    expect(updateRes.status).toBe(200);
    const updateDataResponse = await updateRes.json();
    expect(updateDataResponse.name).toBe(updateData.name);
    expect(updateDataResponse.industry).toBe(updateData.industry);
  });

  it('should delete an organization with authentication', async () => {
    const user = await createAuthenticatedUser('editor');
    // First create an organization
    const companyData = {
      name: `Test Company ${createTestId()}`,
      industry: testOrganizations.valid.industry,
    };

    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, companyData);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    const organizationId = createData.id;

    // Then delete it
    const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/organizations/${organizationId}`, user.sessionToken!);
    expect(deleteRes.status).toBe(204);

    // Verify it's deleted
    const getRes = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${organizationId}`, user.sessionToken!);
    expect(getRes.status).toBe(404);
  });
});
