import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, TSC_CASES, tsc } from './helpers.js';

const REMOTE_CONSUMER_TYPES = `
import {
  composeRemoteRoot, createClusterMeshRuntime, createRemoteChannelCreditWindow,
  PINNED_R11_WET2_TEXT_HASH, REMOTE_MOUNT_MAP_V1, validateRemoteAuthorityBinding,
  validateRemoteTenantAdmission, type RemoteAuthorityBinding,
} from '@sentropic/cluster-mesh';
import { createKernel } from '@sentropic/cluster-mesh/storage';
import { createPostgresKernel } from '@sentropic/cluster-mesh/storage/postgres';
import { createSqliteKernel } from '@sentropic/cluster-mesh/storage/sqlite';

export const surface = [
  composeRemoteRoot, createClusterMeshRuntime, createRemoteChannelCreditWindow,
  PINNED_R11_WET2_TEXT_HASH, REMOTE_MOUNT_MAP_V1, validateRemoteAuthorityBinding,
  validateRemoteTenantAdmission, createKernel, createPostgresKernel, createSqliteKernel,
];
export type Binding = RemoteAuthorityBinding;
`;

const REMOTE_RUNTIME_PROBE = `
import { Hono } from 'hono';
import {
  composeRemoteRoot, createClusterMeshRuntime,
  validateRemoteAuthorityBinding, validateRemoteTenantAdmission,
} from '@sentropic/cluster-mesh';
import * as storage from '@sentropic/cluster-mesh/storage';
import * as pgStorage from '@sentropic/cluster-mesh/storage/postgres';
import * as sqliteStorage from '@sentropic/cluster-mesh/storage/sqlite';

const binding = {
  serviceId: 'remote', tier: 'preprod', meshId: 'remote-preprod',
  publicOrigin: 'https://preprod.remote.sent-tech.ca',
  trunkEndpoint: 'wss://preprod.remote.sent-tech.ca/trunk/v1',
  storage: { engine: 'postgres', storeMeshId: 'remote-preprod', allowedTenants: ['owner', 'isolation-fixture'], dedicatedAuditWriter: true },
  admissionReady: true, receiptPortReady: true,
};
const prodSqliteRefused = validateRemoteAuthorityBinding({
  ...binding, tier: 'prod', meshId: 'remote-prod',
  publicOrigin: 'https://remote.sent-tech.ca', trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1',
  storage: { engine: 'sqlite', storeMeshId: 'remote-prod', allowedTenants: ['owner'], dedicatedAuditWriter: true },
});
const runtime = createClusterMeshRuntime({
  generationId: 'rm0-packed-1', config: { capacity: { poolSize: 1 } },
  context: { async verify() { throw new Error('not invoked'); } },
  registration: { async authorize() { return { ok: false, reason: 'missing_registration' }; } },
  receipts: { async append() {} },
});
const composed = composeRemoteRoot({
  runtime, binding,
  enrolmentModule: {
    namespace: '/apps', enabled: true,
    createRouter: () => new Hono().post('/enrolment/v1/ceremony/open', (c) => c.json({ status: 'pending' }, 201)),
  },
  authRouter: new Hono().get('/callback', (c) => c.json({ route: 'auth' })),
  uiRouter: new Hono().get('/status', (c) => c.json({ route: 'ui' })),
  upgradeAdapter: {
    handleTrunkUpgrade: (req) => req.headers.get('origin')
      ? { ok: false, status: 400, code: 'forbidden_browser_headers' }
      : { ok: true, path: '/trunk/v1', meshId: binding.meshId, tenantId: 'owner' },
    handleBrowserUpgrade: (req) => req.headers.get('origin') !== binding.publicOrigin
      ? { ok: false, status: 403, code: 'invalid_origin' }
      : { ok: true, path: '/ws/v1', meshId: binding.meshId, tenantId: 'owner' },
  },
});

console.log(JSON.stringify({
  mountMap: composed.mountMap,
  validBinding: validateRemoteAuthorityBinding(binding).ok,
  ownerAdmitted: validateRemoteTenantAdmission(binding, 'owner').ok,
  fixtureAdmitted: validateRemoteTenantAdmission(binding, 'isolation-fixture').ok,
  prodSqliteCode: prodSqliteRefused.ok ? null : prodSqliteRefused.code,
  enrolmentStatus: (await composed.app.request('/enrolment/v1/ceremony/open', { method: 'POST' })).status,
  prefixedAppsStatus: (await composed.app.request('/apps/enrolment/v1/ceremony/open', { method: 'POST' })).status,
  authStatus: (await composed.app.request('/auth/callback')).status,
  uiStatus: (await composed.app.request('/status')).status,
  trunkOkStatus: (await composed.app.request('/trunk/v1')).status,
  trunkOriginStatus: (await composed.app.request('/trunk/v1', { headers: { origin: binding.publicOrigin } })).status,
  wsBadOriginStatus: (await composed.app.request('/ws/v1', { headers: { origin: 'https://evil.example' } })).status,
  storageExports: [typeof storage.createKernel, typeof pgStorage.createPostgresKernel, typeof sqliteStorage.createSqliteKernel],
}));
`;

describe.skipIf(!enabled)('RM-0 (a) packed-tarball Remote assembly proof', () => {
  it.each(['bare', 'latest'] as const)(
    'composes the Remote root and resolves storage subpaths from the installed tarball (%s)',
    (fixture) => {
      const result = nodeJson<Record<string, unknown>>(fixtureDir(fixture), REMOTE_RUNTIME_PROBE);
      expect(result).toEqual({
        mountMap: {
          root: '/', pluginNamespace: '/apps', pluginMount: '/',
          enrolmentBase: '/enrolment/v1', authBase: '/auth',
          trunkUpgradePath: '/trunk/v1', browserUpgradePath: '/ws/v1',
        },
        validBinding: true, ownerAdmitted: true, fixtureAdmitted: true,
        prodSqliteCode: 'sqlite_forbidden_in_deployed_tier',
        enrolmentStatus: 201, prefixedAppsStatus: 404, authStatus: 200, uiStatus: 200,
        trunkOkStatus: 200, trunkOriginStatus: 400, wsBadOriginStatus: 403,
        storageExports: ['function', 'function', 'function'],
      });
    },
  );

  it.each(TSC_CASES)('type-checks the RM-0 Remote root and storage imports from the bare tarball (%o)', (options) => {
    const run = tsc(fixtureDir('bare'), 'remote-rm0', REMOTE_CONSUMER_TYPES, options);
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
