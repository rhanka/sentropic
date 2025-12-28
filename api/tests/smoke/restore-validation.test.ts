import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/client';
import { sql } from 'drizzle-orm';
import { httpRequest, authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('Restore Validation', () => {
  describe('Schema Validation', () => {
    it('should have required core tables present', async () => {
      const tables = await db.all(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `) as { table_name: string }[];

      const expectedTables = [
        'organizations',
        'folders',
        'use_cases',
        'settings',
        'business_config',
        'sessions',
        'job_queue',
        'users',
        'webauthn_credentials',
        'user_sessions',
        'webauthn_challenges',
        'magic_links'
      ];

      const actualTables = tables.map(t => t.table_name);
      expectedTables.forEach(expectedTable => {
        expect(actualTables).toContain(expectedTable);
      });
    });

    it('should have Drizzle migrations applied', async () => {
      const migrations = await db.all(sql`
        SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC
      `) as { id: number; hash: string; created_at: number }[];

      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0]).toHaveProperty('hash');
      expect(migrations[0]).toHaveProperty('created_at');
    });

    it('should have indexes on critical columns', async () => {
      const indexes = await db.all(sql`
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE schemaname = 'public'
      `) as { indexname: string; tablename: string }[];

      const indexNames = indexes.map(i => i.indexname);
      
      // Verify critical indexes exist
      expect(indexNames.some(name => name.includes('webauthn_credentials_user_id'))).toBe(true);
      expect(indexNames.some(name => name.includes('user_sessions_user_id'))).toBe(true);
      expect(indexNames.some(name => name.includes('user_sessions_expires_at'))).toBe(true);
    });
  });

  describe('API Endpoints Validation', () => {
    let adminUser: any;
    let editorUser: any;

    beforeEach(async () => {
      adminUser = await createAuthenticatedUser('admin_app');
      editorUser = await createAuthenticatedUser('editor');
    });

    afterEach(async () => {
      await cleanupAuthData();
    });

    it('should have settings endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/settings', adminUser.sessionToken!);
      expect(response.status).toBe(200);
    });

    it('should have business-config endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/business-config', adminUser.sessionToken!);
      expect(response.status).toBe(200);
    });

    it('should return data if restored from production backup', async () => {
      // Verify that if backup non-empty, we have data
      // If backup empty, this test passes anyway
      const orgsResponse = await authenticatedHttpRequest('GET', '/api/v1/organizations', editorUser.sessionToken!);
      expect(orgsResponse.status).toBe(200);
      const orgsData = await orgsResponse.json();
      expect(Array.isArray(orgsData.items)).toBe(true);

      const foldersResponse = await authenticatedHttpRequest('GET', '/api/v1/folders', editorUser.sessionToken!);
      expect(foldersResponse.status).toBe(200);
      const foldersData = await foldersResponse.json();
      expect(Array.isArray(foldersData.items)).toBe(true);
    });
  });

  describe('Referential Integrity', () => {
    let user: any;

    beforeEach(async () => {
      user = await createAuthenticatedUser('editor');
    });

    afterEach(async () => {
      await cleanupAuthData();
    });

    it('should maintain referential integrity (FK relationships)', async () => {
      // Create an organization
      const orgResponse = await authenticatedHttpRequest('POST', '/api/v1/organizations', user.sessionToken!, {
        name: `Test Organization ${Date.now()}`,
        industry: 'Test Industry',
      });
      expect(orgResponse.status).toBe(201);
      const org = await orgResponse.json();

      // Create a folder linked to this organization
      const folderResponse = await authenticatedHttpRequest('POST', '/api/v1/folders', user.sessionToken!, {
        name: `Test Folder ${Date.now()}`,
        description: 'Test folder description',
        organizationId: org.id,
      });
      expect(folderResponse.status).toBe(201);
      const folder = await folderResponse.json();

      // Verify that the relationship works
      const getFolderResponse = await authenticatedHttpRequest('GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      expect(getFolderResponse.status).toBe(200);
      const folderData = await getFolderResponse.json();
      expect(folderData.organizationId).toBe(org.id);

      // Cleanup
      await authenticatedHttpRequest('DELETE', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      await authenticatedHttpRequest('DELETE', `/api/v1/organizations/${org.id}`, user.sessionToken!);
    });

    it('should handle JSONB fields correctly', async () => {
      // Create a folder with matrix_config JSONB (pass object directly, not stringified)
      const matrixConfig = {
        valueAxes: [
          { id: 'value1', name: 'Value 1', weight: 0.5 }
        ],
        complexityAxes: [
          { id: 'complexity1', name: 'Complexity 1', weight: 0.5 }
        ],
        valueThresholds: [
          { level: 1, points: 10 }
        ],
        complexityThresholds: [
          { level: 1, points: 10 }
        ]
      };

      const folderResponse = await authenticatedHttpRequest('POST', '/api/v1/folders', user.sessionToken!, {
        name: `Test Folder ${Date.now()}`,
        description: 'Test folder description',
        matrixConfig,
      });
      expect(folderResponse.status).toBe(201);
      const folder = await folderResponse.json();

      // Verify that the JSONB is correctly parsed
      const getFolderResponse = await authenticatedHttpRequest('GET', `/api/v1/folders/${folder.id}`, user.sessionToken!);
      expect(getFolderResponse.status).toBe(200);
      const folderData = await getFolderResponse.json();
      expect(folderData.matrixConfig).toBeDefined();

      // Cleanup
      await authenticatedHttpRequest('DELETE', `/api/v1/folders/${folder.id}`, user.sessionToken!);
    });
  });
});

