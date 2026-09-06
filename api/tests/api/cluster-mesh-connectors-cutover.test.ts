import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { documentConnectorAccounts } from '../../src/db/schema';
import { createConnectorsNamespaceModule } from '../../src/routes/namespaces/connectors';
import { CONNECTORS_AUTHOR } from '../../src/routes/namespaces/connectors-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { GMAIL_PROVIDER } from '../../src/services/gmail-oauth';
import {
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';
import { createConnectedGoogleDriveToken } from '../utils/google-drive-helper';

const cutovers = new PostgresClusterMeshCutoverStore();
const cutoverKey = { compositionRoot: 'product' as const, namespace: '/connectors' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/connectors'),
));
const mountPluginCandidate = (enabled = true): Hono => new Hono().route(
  '/api/v1',
  createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createConnectorsNamespaceModule({ enabled })],
    mounts: { '/connectors': '/' },
  }),
);

const requestWire = async (
  app: Hono,
  user: TestUser,
  method: string,
  path: string,
  body?: unknown,
) => {
  const response = await app.request(path, {
    method,
    headers: {
      Cookie: `session=${user.sessionToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
};

describe('cluster mesh connectors cutover', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('admin_app');
    const driveToken = createConnectedGoogleDriveToken();
    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      token: driveToken,
      identity: { accountEmail: 'drive@example.com', accountSubject: 'drive-subject' },
    });
    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      token: { ...driveToken, scope: 'https://www.googleapis.com/auth/gmail.readonly' },
      identity: { accountEmail: 'gmail@example.com', accountSubject: 'gmail-subject' },
      provider: GMAIL_PROVIDER,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCutover();
    if (user?.id && user.workspaceId) {
      await db.delete(documentConnectorAccounts).where(and(
        eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
      ));
    }
    await cleanupAuthData();
  });

  it('root-mounts connector paths without gating health and keeps settings privileged', async () => {
    expect((await productApp.request('/api/v1/health')).status).toBe(200);
    expect((await productApp.request('/api/v1/google-drive/connection')).status).toBe(401);
    expect((await productApp.request('/api/v1/gmail/connection')).status).toBe(401);
    expect((await productApp.request(
      '/api/v1/settings/connector-accounts/max-per-provider',
    )).status).toBe(401);
    const editor = await createAuthenticatedUser('editor');
    expect((await requestWire(
      productApp, editor, 'GET', '/api/v1/google-drive/connection',
    )).status).toBe(200);
    expect((await requestWire(
      productApp, editor, 'GET', '/api/v1/settings/connector-accounts/max-per-provider',
    )).status).toBe(403);
    expect((await requestWire(
      productApp, user, 'GET', '/api/v1/connectors/google-drive/connection',
    )).status).toBe(404);
  });

  it('selects one connector author and fails closed after verified rollback', async () => {
    const app = mountPluginCandidate();
    const path = '/api/v1/google-drive/connection';
    expect((await requestWire(app, user, 'GET', path)).status).toBe(200);
    const active = await cutovers.find(cutoverKey);
    expect(active).toMatchObject({
      activeAuthor: CONNECTORS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-connectors-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await cutovers.rollback(cutoverKey, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(cutoverKey)).resolves.toMatchObject({ reversible: true });
    const blocked = await requestWire(app, user, 'GET', path);
    expect(blocked.status).toBe(503);
    expect(JSON.parse(blocked.body)).toEqual({ error: 'wrong_author' });
  });

  it('is disableable without selecting a fallback connector author', async () => {
    const response = await requestWire(
      mountPluginCandidate(false), user, 'GET', '/api/v1/google-drive/connection',
    );
    expect(response.status).toBe(404);
    expect(await cutovers.find(cutoverKey)).toBeNull();
  });
});
