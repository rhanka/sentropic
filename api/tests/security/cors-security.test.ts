import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('CORS Security Tests', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('CORS Headers with Credentials', () => {
    it('should include proper CORS headers for preflight requests', async () => {
      // Test OPTIONS preflight request
      const response = await unauthenticatedRequest(app, 'OPTIONS', '/api/v1/organizations', null, {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      });

      expect(response.status).toBe(204);
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should include proper CORS headers for actual requests', async () => {
      // Test actual GET request with credentials
      const response = await app.request('/api/v1/organizations', {
        method: 'GET',
        headers: {
          'Origin': 'http://localhost:5173',
          'Cookie': `session=${user.sessionToken}`
        }
      });

      expect(response.status).toBe(200);
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should reject requests from disallowed origins', async () => {
      // Test request from disallowed origin
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken, null, {
        'Origin': 'https://malicious.com'
      });

      expect(response.status).toBe(200); // Request succeeds but CORS headers should be missing
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });

    it('should handle wildcard subdomain patterns correctly', async () => {
      // Test request from allowed wildcard subdomain
      const response = await app.request('/api/v1/organizations', {
        method: 'GET',
        headers: {
          'Origin': 'https://app.sent-tech.ca',
          'Cookie': `session=${user.sessionToken}`
        }
      });

      expect(response.status).toBe(200);
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.sent-tech.ca');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should reject requests from non-matching wildcard patterns', async () => {
      // Test request from non-matching wildcard pattern
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken, null, {
        'Origin': 'https://malicious-sent-tech.ca'
      });

      expect(response.status).toBe(200); // Request succeeds but CORS headers should be missing
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('should handle requests without Origin header', async () => {
      // Test request without Origin header (e.g., from server-to-server)
      const response = await authenticatedRequest(app, 'GET', '/api/v1/organizations', user.sessionToken);

      expect(response.status).toBe(200);
      
      const headers = response.headers;
      // CORS headers should not be present for requests without Origin
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('CORS with Different HTTP Methods', () => {
    it('should allow POST requests with proper CORS headers', async () => {
      const newCompany = {
        name: 'Test Company CORS',
        description: 'Test company for CORS testing',
        website: 'https://test-cors.com',
        industry: 'Technology',
        size: 'startup',
        location: 'Test City'
      };

      const response = await app.request('/api/v1/organizations', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
          'Cookie': `session=${user.sessionToken}`
        },
        body: JSON.stringify(newCompany)
      });

      expect(response.status).toBe(201);
      
      const headers = response.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should allow PUT requests with proper CORS headers', async () => {
      // First create a company
      const createResponse = await app.request('/api/v1/organizations', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
          'Cookie': `session=${user.sessionToken}`
        },
        body: JSON.stringify({
          name: 'Test Company for PUT',
          description: 'Test company for PUT CORS testing',
          website: 'https://test-put-cors.com',
          industry: 'Technology',
          size: 'startup',
          location: 'Test City'
        })
      });

      expect(createResponse.status).toBe(201);
      const createdCompany = await createResponse.json();
      
      // Then update it
      const updateResponse = await app.request(`/api/v1/organizations/${createdCompany.id}`, {
        method: 'PUT',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
          'Cookie': `session=${user.sessionToken}`
        },
        body: JSON.stringify({
          name: 'Updated Test Company',
          description: 'Updated description',
          website: 'https://updated-test-put-cors.com',
          industry: 'Technology',
          size: 'startup',
          location: 'Updated Test City'
        })
      });

      expect(updateResponse.status).toBe(200);
      
      const headers = updateResponse.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should allow DELETE requests with proper CORS headers', async () => {
      // First create a company
      const createResponse = await app.request('/api/v1/organizations', {
        method: 'POST',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
          'Cookie': `session=${user.sessionToken}`
        },
        body: JSON.stringify({
          name: 'Test Company for DELETE',
          description: 'Test company for DELETE CORS testing',
          website: 'https://test-delete-cors.com',
          industry: 'Technology',
          size: 'startup',
          location: 'Test City'
        })
      });

      expect(createResponse.status).toBe(201);
      const createdCompany = await createResponse.json();
      
      // Then delete it
      const deleteResponse = await app.request(`/api/v1/organizations/${createdCompany.id}`, {
        method: 'DELETE',
        headers: {
          'Origin': 'http://localhost:5173',
          'Cookie': `session=${user.sessionToken}`
        }
      });

      expect(deleteResponse.status).toBe(204);
      
      const headers = deleteResponse.headers;
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });
});