import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
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
const fixtureRoot = '../fixtures/historical/clients-3e0b3d9c/api/src';
const sourceBlobs = [
  ['routes/api/chrome-extension.ts', 'ef15865bd113163f0b6f919d2ac5b614d763cf8b'],
  ['routes/api/vscode-extension.ts', '828ac6ae4f9b41078c2bac3eb83e03183de80964'],
  ['routes/api/cowork-desktop.ts', '4ccbc19b49769deecc6b04d57353ae23d7884cc0'],
  ['routes/api/client-settings.ts', 'd1cac442ba59047aed95ee05581633a6cf110181'],
] as const;
const bridgeDigests = [
  ['config/default-chat-system.ts', '9203ab798a9396b15593f85aee38323d5d36fd3b35ce80f4a73954da6e12553d'],
  ['config/env.ts', '9854d0af531dd125d8f52843c8dc92ab509eb58511e71dbb00cef6336d3ddf63'],
  ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
  ['db/schema.ts', '45ad03d11cece58952dcbb4480a9d594ad9c5234a25b547195ee61eed8228650'],
  ['middleware/rbac.ts', 'ece31f70cdf786170c4d5f29707268f6263f53e7eee8c0e52aae8c4c169b709b'],
  ['services/session-manager.ts', 'b80f05ab0bde4d657bd5dca444ef551f91bc26b256c8d560886573d4c2dcafe7'],
  ['services/settings.ts', '2ff7a556897605bf6d92b1a11ab73ec9c78849edd655dda25dc442d26d7ce3a6'],
  ['services/tab-registry.ts', '700392db5440ab0ba4f61a5a1291560a589609fa7ac713cdbe981a931e675f2f'],
  ['services/workspace-access.ts', '056c91da8147b5570e77f96b0419d5a6646a192853940360b4e8fce91fb563ee'],
  ['utils/id.ts', '7148d17b36975340ed8d20ae49c96a1b06f7d107b9b2492e32e15fe169a24aa3'],
] as const;
const downloadEnv = {
  chrome: process.env.CHROME_EXTENSION_DOWNLOAD_URL,
  vscode: process.env.VSCODE_EXTENSION_DOWNLOAD_URL,
  cowork: process.env.COWORK_DESKTOP_DOWNLOAD_URL,
};
const clearClientSettings = () => db.delete(settings).where(inArray(settings.key, [
  'cowork_desktop.channel',
  'vscode_extension_token_meta',
  'vscode_project_workspace_state_v1',
]));

describe('cluster mesh clients cutover', () => {
  let admin: TestUser;
  let editor: TestUser;
  const createdWorkspaceIds = new Set<string>();

  beforeEach(async () => {
    await clearCutover();
    await clearClientSettings();
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
    await clearClientSettings();
    if (downloadEnv.chrome === undefined) delete process.env.CHROME_EXTENSION_DOWNLOAD_URL;
    else process.env.CHROME_EXTENSION_DOWNLOAD_URL = downloadEnv.chrome;
    if (downloadEnv.vscode === undefined) delete process.env.VSCODE_EXTENSION_DOWNLOAD_URL;
    else process.env.VSCODE_EXTENSION_DOWNLOAD_URL = downloadEnv.vscode;
    if (downloadEnv.cowork === undefined) delete process.env.COWORK_DESKTOP_DOWNLOAD_URL;
    else process.env.COWORK_DESKTOP_DOWNLOAD_URL = downloadEnv.cowork;
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

  it('executes pinned metadata and token reads over authoritative state', async () => {
    for (const [path, blob] of sourceBlobs) {
      const source = readFileSync(new URL(`${fixtureRoot}/${path}`, import.meta.url));
      expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
        .toBe(blob);
    }
    for (const [path, digest] of bridgeDigests) {
      const bridge = readFileSync(new URL(`${fixtureRoot}/${path}`, import.meta.url));
      expect(createHash('sha256').update(bridge).digest('hex'), path).toBe(digest);
    }

    process.env.CHROME_EXTENSION_DOWNLOAD_URL = '';
    process.env.VSCODE_EXTENSION_DOWNLOAD_URL = '';
    process.env.COWORK_DESKTOP_DOWNLOAD_URL = '';
    await db.insert(settings).values({
      key: 'vscode_extension_token_meta',
      userId: null,
      value: JSON.stringify({
        sessionId: 'historical-session', issuedByUserId: admin.id,
        issuedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2099-09-02T00:00:00.000Z',
        last4: 'd11a', revokedAt: null,
      }),
      description: 'D11 client token read parity',
    });
    const reads = [
      '/api/v1/chrome-extension/download',
      '/api/v1/vscode-extension/download',
      '/api/v1/vscode-extension/code-agent-prompt-profile',
      '/api/v1/cowork-desktop/download',
      '/api/v1/cowork-desktop/channel',
      '/api/v1/settings/vscode-extension-token',
    ];
    for (const path of reads) {
      const invoke = (app: Hono) => authenticatedRequest(
        app, 'GET', path, admin.sessionToken!, undefined, { Origin: 'https://client.test' },
      );
      const legacy = await invoke(historical);
      const active = await invoke(candidate());
      expect({ status: active.status, body: await active.text() }, path)
        .toEqual({ status: legacy.status, body: await legacy.text() });
    }
  });

  it('drives actual candidate and historical tab registrations once each', async () => {
    const register = (app: Hono, tabId: string) => authenticatedRequest(
      app,
      'POST',
      '/api/v1/chrome-extension/tabs/register',
      editor.sessionToken!,
      { tab_id: tabId, source: 'chrome_plugin', url: 'https://client.test', title: 'D11' },
    );
    const active = await register(candidate(), 'candidate-tab');
    const legacy = await register(historical, 'historical-tab');

    expect({ status: active.status, body: await active.json() })
      .toEqual({ status: 200, body: { ok: true, tab_id: 'candidate-tab' } });
    expect({ status: legacy.status, body: await legacy.json() })
      .toEqual({ status: 200, body: { ok: true, tab_id: 'historical-tab' } });
    expect(getTab('candidate-tab')).toMatchObject({ userId: editor.id, status: 'active' });
    expect(getTab('historical-tab')).toMatchObject({ userId: editor.id, status: 'active' });
  });

  it('creates one isolated durable code-workspace twin per direct author', async () => {
    const historicalEditor = await createAuthenticatedUser('editor');
    const invoke = (app: Hono, user: TestUser, fingerprint: string) => authenticatedRequest(
      app,
      'POST',
      '/api/v1/vscode-extension/workspace-mapping/code-workspace',
      user.sessionToken!,
      { projectFingerprint: fingerprint, name: 'D11 isolated code workspace' },
    );
    const active = await invoke(candidate(), editor, 'candidate:d11');
    const activeBody = await active.json() as { mappedWorkspaceId: string; mappedWorkspaceName: string };
    createdWorkspaceIds.add(activeBody.mappedWorkspaceId);
    expect(active.status).toBe(201);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, activeBody.mappedWorkspaceId)))
      .toEqual([expect.objectContaining({ ownerUserId: editor.id, name: activeBody.mappedWorkspaceName })]);
    expect(await db.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, activeBody.mappedWorkspaceId),
      eq(workspaceMemberships.userId, editor.id),
    ))).toEqual([expect.objectContaining({ role: 'admin' })]);

    const legacy = await invoke(historical, historicalEditor, 'historical:d11');
    const legacyBody = await legacy.json() as { mappedWorkspaceId: string; mappedWorkspaceName: string };
    createdWorkspaceIds.add(legacyBody.mappedWorkspaceId);
    expect({ status: active.status, name: activeBody.mappedWorkspaceName })
      .toEqual({ status: legacy.status, name: legacyBody.mappedWorkspaceName });
    expect(await db.select().from(workspaces).where(inArray(
      workspaces.id, [activeBody.mappedWorkspaceId, legacyBody.mappedWorkspaceId],
    ))).toHaveLength(2);
    for (const userId of [editor.id, historicalEditor.id]) {
      const state = await db.select().from(settings).where(and(
        eq(settings.key, 'vscode_project_workspace_state_v1'), eq(settings.userId, userId),
      ));
      expect(state).toHaveLength(1);
      expect(JSON.parse(state[0].value ?? '{}').codeWorkspaceIds).toHaveLength(1);
    }
  });

  it('selects one direct author and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    const path = '/api/v1/settings/vscode-extension-token';
    expect((await authenticatedRequest(app, 'GET', path, admin.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: CLIENT_AUTHOR,
      previousGenerationId: 'legacy-api-clients-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-client-routers' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, admin.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no disabled, duplicate, bookmarklet, or unavailable-control fallback', async () => {
    const path = '/api/v1/settings/vscode-extension-token';
    expect((await candidate().request(path)).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(false).request(path)).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/clients/settings/vscode-extension-token', admin.sessionToken!,
    )).status).toBe(404);

    for (const bookmarkletPath of [
      '/api/v1/bookmarklet/injected-script.js', '/api/v1/bookmarklet/probe.js',
      '/api/v1/bookmarklet/register', '/api/v1/bookmarklet/poll', '/api/v1/bookmarklet/result',
    ]) {
      const response = await productApp.request(bookmarkletPath);
      expect(response.status, bookmarkletPath).toBe(404);
      expect(response.headers.get('cross-origin-resource-policy'), bookmarkletPath).toBeNull();
    }

    const unavailable: ClientsCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, productClientsPorts, unavailable), 'GET', path, admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'client_control_unavailable' });
  });

  it('uses exact auth paths and an authority-neutral injectable transport', () => {
    const transportPaths = [...new Set(
      createClientsTransportRouter(productClientsPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(transportPaths).toEqual([...CLIENT_PATHS].sort());
    expect(CLIENT_PATHS).toHaveLength(12);
    expect(CLIENT_PATHS).not.toContain('/*');
    expect(CLIENT_ROUTES).toHaveLength(16);

    const routes = createClientsNamespaceModule().createRouter().routes;
    for (const [method, path] of CLIENT_ROUTES) {
      expect(routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ method, path, handler: requireAuth }),
      ]));
    }
    const source = readFileSync(
      new URL('../../src/routes/namespaces/clients.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
  });

  it('registers one root author and leaves no legacy client or bookmarklet source', async () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/clients',
    );
    expect(registration?.module.namespace).toBe('/clients');
    expect(registration?.authPaths).toEqual(CLIENT_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/clients']).toBe('/');
    expect((await productApp.request('/api/v1/chrome-extension/download')).status).toBe(401);
    expect((await productApp.request('/api/v1/clients/chrome-extension/download')).status).toBe(404);

    for (const name of [
      'chrome-extension', 'vscode-extension', 'cowork-desktop', 'client-settings',
    ]) {
      expect(existsSync(new URL(`../../src/routes/api/${name}.ts`, import.meta.url))).toBe(false);
    }
    expect(existsSync(new URL('../../src/upstream/injected-script.ts', import.meta.url))).toBe(false);
    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(
      /chromeExtensionRouter|vscodeExtensionRouter|coworkDesktopRouter|clientSettingsRouter/,
    );
  });
});
