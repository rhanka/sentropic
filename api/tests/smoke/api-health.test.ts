import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { httpRequest, authenticatedHttpRequest } from '../utils/test-helpers';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

describe('API Health', () => {
  it('emits the live health cutover and control-loss status map', async () => {
    const active = await httpRequest('/api/v1/health');
    const duplicate = await httpRequest('/api/v1/health/health');
    const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
      eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
      eq(clusterMeshNamespaceCutovers.namespace, '/health'),
    ));
    expect(records).toEqual([expect.objectContaining({
      status: 'active', activeAuthor: 'health-hono-module', shadowComparison: null,
    })]);
    const body = await active.json();
    expect(body).toMatchObject({
      status: 'ok', readiness: { status: 'ready', reasons: [] },
      clusterMesh: { generation: { generationId: 'cluster-mesh-session-v1', status: 'active' } },
    });

    await db.execute(sql.raw(
      'ALTER TABLE control.cluster_mesh_namespace_cutovers '
      + 'RENAME TO cluster_mesh_namespace_cutovers_lot29_probe',
    ));
    let unavailable: Response;
    try {
      unavailable = await httpRequest('/api/v1/health');
    } finally {
      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot29_probe '
        + 'RENAME TO cluster_mesh_namespace_cutovers',
      ));
    }
    const recovered = await httpRequest('/api/v1/health');
    const statuses = {
      active: active.status,
      duplicate: duplicate.status,
      controlUnavailable: unavailable.status,
      recovered: recovered.status,
    };
    console.info(`D11_HEALTH_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
    expect(statuses).toEqual({ active: 200, duplicate: 404, controlUnavailable: 503, recovered: 200 });
    await expect(unavailable.json()).resolves.toEqual({ error: 'health_control_unavailable' });
  });

  it('keeps health anonymous while gating connector and agent administration paths', async () => {
    const response = await httpRequest('/api/v1/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');

    const disabledCli = await httpRequest('/api/v1/cli/intents', { method: 'POST' });
    expect(disabledCli.status).toBe(404);
    for (const path of ['/command', '/commands', '/terminal', '/shell']) {
      const legacyCli = await httpRequest(`/api/v1${path}`, { method: 'POST' });
      expect(legacyCli.status, path).toBe(404);
    }

    const connectorPaths: ReadonlyArray<readonly [method: string, path: string]> = [
      ['GET', '/api/v1/google-drive/connection'],
      ['GET', '/api/v1/google-drive/picker-config'],
      ['POST', '/api/v1/google-drive/files/resolve-picker-selection'],
      ['POST', '/api/v1/google-drive/oauth/start'],
      ['GET', '/api/v1/google-drive/oauth/callback'],
      ['POST', '/api/v1/google-drive/disconnect'],
      ['GET', '/api/v1/gmail/connection'],
      ['POST', '/api/v1/gmail/oauth/start'],
      ['GET', '/api/v1/gmail/oauth/callback'],
      ['POST', '/api/v1/gmail/disconnect'],
      ['PUT', '/api/v1/settings/connector-accounts/max-per-provider'],
      ['GET', '/api/v1/agent-config'],
      ['GET', '/api/v1/prompts'],
      ['GET', '/api/v1/streams/active'],
      ['GET', '/api/v1/streams/sse'],
    ];
    for (const [method, path] of connectorPaths) {
      const gatedResponse = await httpRequest(path, { method });
      expect(gatedResponse.status, `${method} ${path}`).toBe(401);
    }
  });

  describe('Authenticated endpoints', () => {
    let user: any;

    beforeEach(async () => {
      user = await createAuthenticatedUser('editor');
    });

    afterEach(async () => {
      await cleanupAuthData();
    });

    it('emits the live business cutover probe status map', async () => {
      const [health, canonical, duplicate, anonymousDocx, authenticatedDocx] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/organizations'),
        httpRequest('/api/v1/business/organizations'),
        httpRequest('/api/v1/use-cases/historical-id/docx'),
        authenticatedHttpRequest(
          'GET', '/api/v1/use-cases/historical-id/docx', user.sessionToken!,
        ),
      ]);
      const statuses = {
        health: health.status,
        canonicalBusinessAnonymous: canonical.status,
        duplicateBusiness: duplicate.status,
        docxAnonymous: anonymousDocx.status,
        docxAuthenticated: authenticatedDocx.status,
      };
      console.info(`D11_BUSINESS_PROBE ${JSON.stringify(statuses)}`);
      expect(statuses).toEqual({
        health: 200, canonicalBusinessAnonymous: 401, duplicateBusiness: 404,
        docxAnonymous: 401, docxAuthenticated: 410,
      });
    });

    it('emits the live client cutover and control-loss status map', async () => {
      const register = (tabId: string) => authenticatedHttpRequest(
        'POST', '/api/v1/chrome-extension/tabs/register', user.sessionToken!,
        { tab_id: tabId, source: 'chrome_plugin', url: 'https://client.test', title: 'Lot 27 cold proof' },
      );
      const [health, anonymous, duplicate, bookmarklet, active] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/chrome-extension/tabs/register', { method: 'POST' }),
        httpRequest('/api/v1/clients/chrome-extension/tabs/register', { method: 'POST' }),
        httpRequest('/api/v1/bookmarklet/injected-script.js'),
        register(`lot27-cold-before-${user.id}`),
      ]);
      const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
        eq(clusterMeshNamespaceCutovers.namespace, '/clients'),
      ));
      expect(records).toEqual([expect.objectContaining({
        status: 'active', activeAuthor: 'clients-hono-module', shadowComparison: null,
      })]);

      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers '
        + 'RENAME TO cluster_mesh_namespace_cutovers_lot27_probe',
      ));
      let unavailable: Response;
      try {
        unavailable = await register(`lot27-cold-unavailable-${user.id}`);
      } finally {
        await db.execute(sql.raw(
          'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot27_probe '
          + 'RENAME TO cluster_mesh_namespace_cutovers',
        ));
      }
      const recovered = await register(`lot27-cold-after-${user.id}`);
      const statuses = {
        health: health.status,
        anonymousClient: anonymous.status,
        duplicateClient: duplicate.status,
        bookmarklet: bookmarklet.status,
        bookmarkletCorp: bookmarklet.headers.get('cross-origin-resource-policy'),
        activeClient: active.status,
        controlUnavailable: unavailable.status,
        recoveredClient: recovered.status,
      };
      console.info(`D11_CLIENT_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
      expect(statuses).toEqual({
        health: 200, anonymousClient: 401, duplicateClient: 404,
        bookmarklet: 404, bookmarkletCorp: null, activeClient: 200,
        controlUnavailable: 503, recoveredClient: 200,
      });
      await expect(unavailable.json()).resolves.toEqual({ error: 'client_control_unavailable' });
    });

    it('emits the live admin cutover and control-loss status map', async () => {
      const appAdmin = await createAuthenticatedUser('admin_app');
      const read = () => authenticatedHttpRequest(
        'GET', '/api/v1/admin/users', appAdmin.sessionToken!,
      );
      const [health, anonymous, duplicate, active] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/admin/users'),
        authenticatedHttpRequest(
          'GET', '/api/v1/admin/admin/users', appAdmin.sessionToken!,
        ),
        read(),
      ]);
      const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
        eq(clusterMeshNamespaceCutovers.namespace, '/admin'),
      ));
      expect(records).toEqual([expect.objectContaining({
        status: 'active', activeAuthor: 'admin-hono-module', shadowComparison: null,
      })]);

      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers '
        + 'RENAME TO cluster_mesh_namespace_cutovers_lot28_probe',
      ));
      let unavailable: Response;
      try {
        unavailable = await read();
      } finally {
        await db.execute(sql.raw(
          'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot28_probe '
          + 'RENAME TO cluster_mesh_namespace_cutovers',
        ));
      }
      const recovered = await read();
      const statuses = {
        health: health.status,
        anonymousAdmin: anonymous.status,
        duplicateAdmin: duplicate.status,
        activeAdmin: active.status,
        controlUnavailable: unavailable.status,
        recoveredAdmin: recovered.status,
      };
      console.info(`D11_ADMIN_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
      expect(statuses).toEqual({
        health: 200,
        anonymousAdmin: 401,
        duplicateAdmin: 404,
        activeAdmin: 200,
        controlUnavailable: 503,
        recoveredAdmin: 200,
      });
      await expect(unavailable.json()).resolves.toEqual({ error: 'admin_control_unavailable' });
    });

    it('emits the live apps cutover and control-loss status map', async () => {
      const appAdmin = await createAuthenticatedUser('admin_app');
      const read = () => authenticatedHttpRequest(
        'GET', '/api/v1/apps/templates', appAdmin.sessionToken!,
      );
      const [health, anonymous, duplicate, active] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/apps/templates'),
        authenticatedHttpRequest(
          'GET', '/api/v1/apps/apps/templates', appAdmin.sessionToken!,
        ),
        read(),
      ]);
      const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
        eq(clusterMeshNamespaceCutovers.namespace, '/apps'),
      ));
      expect(records).toEqual([expect.objectContaining({
        status: 'active', activeAuthor: 'apps-hono-module', shadowComparison: null,
      })]);

      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers '
        + 'RENAME TO cluster_mesh_namespace_cutovers_lot30_probe',
      ));
      let unavailable: Response;
      try {
        unavailable = await read();
      } finally {
        await db.execute(sql.raw(
          'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot30_probe '
          + 'RENAME TO cluster_mesh_namespace_cutovers',
        ));
      }
      const recovered = await read();
      const statuses = {
        health: health.status,
        anonymousApps: anonymous.status,
        duplicateApps: duplicate.status,
        activeApps: active.status,
        controlUnavailable: unavailable.status,
        recoveredApps: recovered.status,
      };
      console.info(`LOT30_APPS_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
      expect(statuses).toEqual({
        health: 200,
        anonymousApps: 401,
        duplicateApps: 404,
        activeApps: 200,
        controlUnavailable: 503,
        recoveredApps: 200,
      });
      await expect(unavailable.json()).resolves.toEqual({ error: 'apps_control_unavailable' });
    });

    it('emits the live catalog cutover and control-loss status map', async () => {
      const catalogUser = await createAuthenticatedUser('editor');
      const read = () => authenticatedHttpRequest(
        'GET', '/api/v1/catalog/entries', catalogUser.sessionToken!,
      );
      const [health, anonymous, duplicate, active] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/catalog/entries'),
        authenticatedHttpRequest(
          'GET', '/api/v1/catalog/catalog/entries', catalogUser.sessionToken!,
        ),
        read(),
      ]);
      const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
        eq(clusterMeshNamespaceCutovers.namespace, '/catalog'),
      ));
      expect(records).toEqual([expect.objectContaining({
        status: 'active', activeAuthor: 'catalog-hono-module', shadowComparison: null,
      })]);

      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers '
        + 'RENAME TO cluster_mesh_namespace_cutovers_lot31_probe',
      ));
      let unavailable: Response;
      try {
        unavailable = await read();
      } finally {
        await db.execute(sql.raw(
          'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot31_probe '
          + 'RENAME TO cluster_mesh_namespace_cutovers',
        ));
      }
      const recovered = await read();
      const statuses = {
        health: health.status,
        anonymousCatalog: anonymous.status,
        duplicateCatalog: duplicate.status,
        activeCatalog: active.status,
        controlUnavailable: unavailable.status,
        recoveredCatalog: recovered.status,
      };
      console.info(`LOT31_CATALOG_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
      expect(statuses).toEqual({
        health: 200,
        anonymousCatalog: 401,
        duplicateCatalog: 404,
        activeCatalog: 200,
        controlUnavailable: 503,
        recoveredCatalog: 200,
      });
      await expect(unavailable.json()).resolves.toEqual({ error: 'catalog_control_unavailable' });
    });

    it('emits the live resources cutover and control-loss status map', async () => {
      const read = () => authenticatedHttpRequest(
        'POST', '/api/v1/resources/list', user.sessionToken!, { path: '/' },
      );
      const [health, anonymous, duplicate, active] = await Promise.all([
        httpRequest('/api/v1/health'),
        httpRequest('/api/v1/resources/list', {
          method: 'POST', body: JSON.stringify({ path: '/' }),
        }),
        authenticatedHttpRequest(
          'POST', '/api/v1/resources/resources/list', user.sessionToken!, { path: '/' },
        ),
        read(),
      ]);
      const records = await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
        eq(clusterMeshNamespaceCutovers.namespace, '/resources'),
      ));
      expect(records).toEqual([expect.objectContaining({
        status: 'active', activeAuthor: 'resources-hono-module', shadowComparison: null,
      })]);

      await db.execute(sql.raw(
        'ALTER TABLE control.cluster_mesh_namespace_cutovers '
        + 'RENAME TO cluster_mesh_namespace_cutovers_lot32_probe',
      ));
      let unavailable: Response;
      try {
        unavailable = await read();
      } finally {
        await db.execute(sql.raw(
          'ALTER TABLE control.cluster_mesh_namespace_cutovers_lot32_probe '
          + 'RENAME TO cluster_mesh_namespace_cutovers',
        ));
      }
      const recovered = await read();
      const statuses = {
        health: health.status,
        anonymousResources: anonymous.status,
        duplicateResources: duplicate.status,
        activeResources: active.status,
        controlUnavailable: unavailable.status,
        recoveredResources: recovered.status,
      };
      console.info(`LOT32_RESOURCES_PROBE ${JSON.stringify({ statuses, cutover: records[0] })}`);
      expect(statuses).toEqual({
        health: 200,
        anonymousResources: 401,
        duplicateResources: 404,
        activeResources: 200,
        controlUnavailable: 503,
        recoveredResources: 200,
      });
      await expect(unavailable.json()).resolves.toEqual({ error: 'resources_control_unavailable' });
    });

    it('should have organizations endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/organizations', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have folders endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/folders', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('should have initiatives endpoint accessible', async () => {
      const response = await authenticatedHttpRequest('GET', '/api/v1/initiatives', user.sessionToken!);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
