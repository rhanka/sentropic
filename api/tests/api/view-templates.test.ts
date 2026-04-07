import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData,
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { viewTemplates, workspaceMemberships } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { viewTemplateService } from '../../src/services/view-template-service';

describe('View Templates API', () => {
  let user: any;
  let viewer: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_org', `admin-${createTestId()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-${createTestId()}@example.com`);
    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: viewer.id, role: 'viewer', createdAt: new Date() })
        .onConflictDoNothing();
    }
  });

  afterEach(async () => {
    // Clean up view templates created during tests
    if (user.workspaceId) {
      await db.delete(viewTemplates).where(eq(viewTemplates.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
  });

  describe('GET /view-templates/resolve', () => {
    it('should return 400 when missing required parameters', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/view-templates/resolve',
        user.sessionToken!,
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing required');
    });

    it('should return 400 when missing workspaceType', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&objectType=initiative`,
        user.sessionToken!,
      );
      expect(response.status).toBe(400);
    });

    it('should resolve a code-level default template for ai-ideas initiative', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=initiative`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('descriptor');
      expect(data.descriptor).toHaveProperty('tabs');
      expect(Array.isArray(data.descriptor.tabs)).toBe(true);
      expect(data.workspaceType).toBe('ai-ideas');
      expect(data.objectType).toBe('initiative');
    });

    it('should resolve a code-level default template for organization', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=organization`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('descriptor');
      expect(data.descriptor).toHaveProperty('tabs');
    });

    it('should resolve a code-level default template for dashboard', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=dashboard`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.descriptor.tabs).toBeDefined();
    });

    it('should resolve opportunity workspace templates', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=opportunity&objectType=initiative`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.descriptor.tabs).toBeDefined();
      // Opportunity initiative template should have multiple tabs (detail + solutions + proposals)
      expect(data.descriptor.tabs.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 404 for non-existent objectType', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=nonexistent`,
        user.sessionToken!,
      );
      expect(response.status).toBe(404);
    });

    it('should prefer user-level template over code-level default', async () => {
      // Create a user-level template
      const userDescriptor = {
        tabs: [{ key: 'custom', label: 'Custom Tab', always: true, rows: [{ columns: 1, fields: [{ key: 'name', type: 'text' }] }] }],
      };
      await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: userDescriptor,
        sourceLevel: 'user',
      });

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=initiative`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.descriptor.tabs[0].key).toBe('custom');
      expect(data.sourceLevel).toBe('user');
    });
  });

  describe('GET /view-templates (list)', () => {
    it('should return 400 when missing workspaceId', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/view-templates',
        user.sessionToken!,
      );
      expect(response.status).toBe(400);
    });

    it('should list view templates for a workspace', async () => {
      // Seed templates first
      await viewTemplateService.seedForWorkspace(user.workspaceId!, 'ai-ideas');

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('items');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
    });

    it('should filter templates by workspaceType', async () => {
      await viewTemplateService.seedForWorkspace(user.workspaceId!, 'ai-ideas');

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=ai-ideas`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items.length).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(item.workspaceType).toBe('ai-ideas');
      }
    });

    it('should return empty list for non-existent workspaceType filter', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=nonexistent`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items).toEqual([]);
    });
  });

  describe('GET /view-templates/:id', () => {
    it('should return 404 for non-existent template', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/view-templates/non-existent-id',
        user.sessionToken!,
      );
      expect(response.status).toBe(404);
    });

    it('should return a template by id', async () => {
      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'test', label: 'Test', always: true, rows: [{ columns: 1, fields: [{ key: 'name', type: 'text' }] }] }] },
      });

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/${created.id}`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(created.id);
      expect(data.workspaceType).toBe('ai-ideas');
      expect(data.objectType).toBe('initiative');
    });
  });

  describe('Service: seedForWorkspace', () => {
    it('should seed ai-ideas templates on workspace creation', async () => {
      await viewTemplateService.seedForWorkspace(user.workspaceId!, 'ai-ideas');

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=ai-ideas`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      // ai-ideas should have initiative, organization, dashboard templates
      const objectTypes = data.items.map((i: any) => i.objectType);
      expect(objectTypes).toContain('initiative');
      expect(objectTypes).toContain('organization');
      expect(objectTypes).toContain('dashboard');
    });

    it('should seed opportunity templates on workspace creation', async () => {
      await viewTemplateService.seedForWorkspace(user.workspaceId!, 'opportunity');

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=opportunity`,
        user.sessionToken!,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      const objectTypes = data.items.map((i: any) => i.objectType);
      expect(objectTypes).toContain('initiative');
      expect(objectTypes).toContain('organization');
      expect(objectTypes).toContain('dashboard');
    });

    it('should not seed additional workspace-level templates for neutral type', async () => {
      // Count templates before seeding
      const beforeResponse = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=neutral`,
        user.sessionToken!,
      );
      expect(beforeResponse.status).toBe(200);
      const beforeData = await beforeResponse.json();
      const countBefore = beforeData.items.length;

      await viewTemplateService.seedForWorkspace(user.workspaceId!, 'neutral');

      const afterResponse = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}&workspaceType=neutral`,
        user.sessionToken!,
      );
      expect(afterResponse.status).toBe(200);
      const afterData = await afterResponse.json();
      // Neutral workspace seeding should not add any workspace-specific templates
      // (system seeds with workspaceId=null may already exist from migrations)
      expect(afterData.items.length).toBe(countBefore);
    });
  });

  describe('Service: CRUD operations', () => {
    it('should create and retrieve a view template', async () => {
      const descriptor = {
        tabs: [{ key: 'detail', label: 'Detail', always: true, rows: [{ columns: 1, fields: [{ key: 'name', type: 'text' }] }] }],
      };

      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor,
        sourceLevel: 'user',
      });

      expect(created.id).toBeDefined();
      expect(created.workspaceType).toBe('ai-ideas');
      expect(created.objectType).toBe('initiative');
      expect(created.sourceLevel).toBe('user');
      expect(created.version).toBe(1);

      const retrieved = await viewTemplateService.getById(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should update a view template descriptor', async () => {
      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'v1', label: 'V1', always: true, rows: [{ columns: 1, fields: [] }] }] },
      });

      const newDescriptor = { tabs: [{ key: 'v2', label: 'V2', always: true, rows: [{ columns: 2, fields: [] }] }] };
      const updated = await viewTemplateService.update(created.id, { descriptor: newDescriptor });

      expect(updated).not.toBeNull();
      expect(updated!.version).toBe(2);
      expect((updated!.descriptor as any).tabs[0].key).toBe('v2');
    });

    it('should return null when updating non-existent template', async () => {
      const result = await viewTemplateService.update('non-existent', { descriptor: { tabs: [] } });
      expect(result).toBeNull();
    });

    it('should fork a template', async () => {
      const source = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'source', label: 'Source', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });

      const forked = await viewTemplateService.fork(source.id, user.workspaceId!);

      expect(forked.id).not.toBe(source.id);
      expect(forked.workspaceId).toBe(user.workspaceId);
      expect(forked.parentId).toBe(source.id);
      expect(forked.sourceLevel).toBe('user');
      expect(forked.isDetached).toBe(false);
    });

    it('should detach a forked template', async () => {
      const source = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'src', label: 'Src', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });

      const forked = await viewTemplateService.fork(source.id, user.workspaceId!);
      const detached = await viewTemplateService.detach(forked.id);

      expect(detached).not.toBeNull();
      expect(detached!.isDetached).toBe(true);
      expect(detached!.parentId).toBe(source.id);
    });

    it('should remove a user-created workspace template', async () => {
      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [] },
        sourceLevel: 'user',
      });

      const result = await viewTemplateService.remove(created.id);
      expect(result).toEqual({ deleted: true, forbidden: false });

      const retrieved = await viewTemplateService.getById(created.id);
      expect(retrieved).toBeNull();
    });

    it('should not remove system templates (workspaceId is null)', async () => {
      const created = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [] },
        sourceLevel: 'code',
      });

      const result = await viewTemplateService.remove(created.id);
      expect(result).toEqual({ deleted: false, forbidden: true });

      // Clean up manually since remove won't delete it
      await db.delete(viewTemplates).where(eq(viewTemplates.id, created.id));
    });

    it('should return not-deleted when removing non-existent template', async () => {
      const result = await viewTemplateService.remove('non-existent');
      expect(result).toEqual({ deleted: false, forbidden: false });
    });
  });

  describe('POST /view-templates/:id/copy', () => {
    it('should copy a system template into the workspace', async () => {
      // Create a system-level template (workspaceId=null)
      const system = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'sys', label: 'System', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/view-templates/${system.id}/copy`,
        user.sessionToken!,
        {},
      );
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).not.toBe(system.id);
      expect(data.parentId).toBe(system.id);
      expect(data.workspaceId).toBe(user.workspaceId);

      // Clean up: delete copy first (FK), then system parent
      await db.delete(viewTemplates).where(eq(viewTemplates.id, data.id));
      await db.delete(viewTemplates).where(eq(viewTemplates.id, system.id));
    });

    it('should return 409 when copy already exists', async () => {
      const system = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'dup', label: 'Dup', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });

      // First copy succeeds
      const first = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/view-templates/${system.id}/copy`,
        user.sessionToken!,
        {},
      );
      expect(first.status).toBe(201);

      const firstData = await first.json();

      // Second copy returns 409
      const second = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/view-templates/${system.id}/copy`,
        user.sessionToken!,
        {},
      );
      expect(second.status).toBe(409);

      // Clean up: delete copy first (FK), then system parent
      await db.delete(viewTemplates).where(eq(viewTemplates.id, firstData.id));
      await db.delete(viewTemplates).where(eq(viewTemplates.id, system.id));
    });
  });

  describe('POST /view-templates/:id/reset', () => {
    it('should delete the copy and return the system parent', async () => {
      const system = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'parent', label: 'Parent', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });

      const copy = await viewTemplateService.copy(system.id, user.workspaceId!);

      const response = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/view-templates/${copy.id}/reset`,
        user.sessionToken!,
        {},
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(system.id);

      // Copy should be gone
      const gone = await viewTemplateService.getById(copy.id);
      expect(gone).toBeNull();

      await db.delete(viewTemplates).where(eq(viewTemplates.id, system.id));
    });

    it('should return 400 when resetting a template without a parent', async () => {
      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [] },
        sourceLevel: 'user',
      });

      const response = await authenticatedRequest(
        app,
        'POST',
        `/api/v1/view-templates/${created.id}/reset`,
        user.sessionToken!,
        {},
      );
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /view-templates/:id', () => {
    it('should delete a user-created template with no parent', async () => {
      const created = await viewTemplateService.create({
        workspaceId: user.workspaceId!,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [] },
        sourceLevel: 'user',
      });

      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/view-templates/${created.id}`,
        user.sessionToken!,
      );
      expect(response.status).toBe(204);
    });

    it('should return 403 when deleting a system template', async () => {
      const system = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [] },
        sourceLevel: 'code',
      });

      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/view-templates/${system.id}`,
        user.sessionToken!,
      );
      expect(response.status).toBe(403);

      await db.delete(viewTemplates).where(eq(viewTemplates.id, system.id));
    });

    it('should return 403 when deleting a copied template (has parentId)', async () => {
      const system = await viewTemplateService.create({
        workspaceId: null,
        workspaceType: 'ai-ideas',
        objectType: 'initiative',
        descriptor: { tabs: [{ key: 'x', label: 'X', always: true, rows: [{ columns: 1, fields: [] }] }] },
        sourceLevel: 'code',
      });
      const copy = await viewTemplateService.copy(system.id, user.workspaceId!);

      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/view-templates/${copy.id}`,
        user.sessionToken!,
      );
      expect(response.status).toBe(403);

      // Clean up: delete copy first (FK constraint), then system parent
      await db.delete(viewTemplates).where(eq(viewTemplates.id, copy.id));
      await db.delete(viewTemplates).where(eq(viewTemplates.id, system.id));
    });
  });

  describe('POST /view-templates/:id/detach (deprecated)', () => {
    it('should return 410 Gone', async () => {
      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/view-templates/any-id/detach',
        user.sessionToken!,
        {},
      );
      expect(response.status).toBe(410);
    });
  });

  describe('Access control', () => {
    it('should allow viewer to list view templates', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates?workspaceId=${user.workspaceId}`,
        viewer.sessionToken!,
      );
      // viewer has workspace access via membership
      expect(response.status).toBe(200);
    });

    it('should allow viewer to resolve view templates', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/view-templates/resolve?workspaceId=${user.workspaceId}&workspaceType=ai-ideas&objectType=initiative`,
        viewer.sessionToken!,
      );
      expect(response.status).toBe(200);
    });
  });
});
