import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { settings, workspaceMemberships, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin } from '../../src/middleware/rbac';
import type { ClientsCutoverControl } from '../../src/routes/namespaces/clients-cutover';
import {
  CLIENT_AUTHOR,
  CLIENT_PATHS,
  CLIENT_ROUTES,
  createClientsNamespaceModule,
  createClientsTransportRouter,
  type ClientsNamespacePorts,
} from '../../src/routes/namespaces/clients-module';
import { productClientsPorts } from '../../src/routes/namespaces/clients-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { clearAll, getTab } from '../../src/services/tab-registry';
import { chromeExtensionRouter as legacyChromeRouter } from '../fixtures/historical/clients-3e0b3d9c/api/src/routes/api/chrome-extension';
import { clientSettingsRouter as legacyAuthClientRouter } from '../fixtures/historical/clients-3e0b3d9c/api/src/routes/api/client-settings';
import { coworkDesktopRouter as legacyCoworkRouter } from '../fixtures/historical/clients-3e0b3d9c/api/src/routes/api/cowork-desktop';
import { vscodeExtensionRouter as legacyVsCodeRouter } from '../fixtures/historical/clients-3e0b3d9c/api/src/routes/api/vscode-extension';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/clients' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: ClientsNamespacePorts = productClientsPorts,
  cutoverControl?: ClientsCutoverControl,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createClientsNamespaceModule({ enabled, ports, cutoverControl })],
  mounts: { '/clients': '/' },
}));
const historical = new Hono()
  .use('/api/v1/chrome-extension/*', requireAuth)
  .route('/api/v1/chrome-extension', legacyChromeRouter)
  .use('/api/v1/vscode-extension/*', requireAuth)
  .route('/api/v1/vscode-extension', legacyVsCodeRouter)
  .use('/api/v1/cowork-desktop/*', requireAuth)
  .route('/api/v1/cowork-desktop', legacyCoworkRouter)
  .use('/api/v1/settings/vscode-extension-token', requireAuth, requireAdmin)
  .route('/api/v1/settings', legacyAuthClientRouter);

describe('cluster mesh clients cutover', () => {
  let admin: TestUser;
  let editor: TestUser;
  const createdWorkspaceIds = new Set<string>();

  beforeEach(async () => {
    await clearCutover();
    clearAll();
    admin = await createAuthenticatedUser('admin_app');
    editor = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (createdWorkspaceIds.size > 0) {
      const ids = [...createdWorkspaceIds];
      await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, ids));
      await db.delete(workspaces).where(inArray(workspaces.id, ids));
      createdWorkspaceIds.clear();
    }
    await db.delete(settings).where(inArray(settings.key, [
      'cowork_desktop.channel',
      'vscode_extension_token_meta',
      'vscode_project_workspace_state_v1',
    ]));
    await clearCutover();
    clearAll();
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  it('constructs only with all five explicit product ports', () => {
    expect(() => createClientsTransportRouter({
      ...productClientsPorts,
      tabs: undefined,
    } as unknown as ClientsNamespacePorts)).toThrowError('client product ports are unavailable');
    expect(createClientsTransportRouter(productClientsPorts).routes.length).toBeGreaterThan(0);
  });
});
