import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  unauthenticatedRequest,
} from '../utils/auth-helper';

describe('Tenant resolution metrics API', () => {
  let adminToken: string;
  let editorToken: string;

  beforeEach(async () => {
    const [admin, editor] = await Promise.all([
      createAuthenticatedUser('admin_org'),
      createAuthenticatedUser('editor'),
    ]);
    adminToken = admin.sessionToken!;
    editorToken = editor.sessionToken!;
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('returns tenant-resolution metric snapshots to an admin', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/admin/tenant-resolution-metrics',
      adminToken,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      total: expect.any(Object),
      divergence: expect.any(Object),
    });
  });

  it('rejects a non-admin user', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/admin/tenant-resolution-metrics',
      editorToken,
    );

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated user', async () => {
    const response = await unauthenticatedRequest(app, 'GET', '/api/v1/admin/tenant-resolution-metrics');

    expect(response.status).toBe(401);
  });
});
