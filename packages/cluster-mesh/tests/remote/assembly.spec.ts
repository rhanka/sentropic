import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createClusterMeshRuntime, NamespaceRegistrationError, type ClusterMeshHonoNamespaceModule } from '../../src/index.js';
import {
  composeRemoteRoot, REMOTE_MOUNT_MAP_V1, RemoteAssemblyError, validateRemoteAuthorityBinding,
  validateRemoteTenantAdmission, type RemoteAuthorityBinding, type RemoteTier, type RemoteUpgradeAdapter,
} from '../../src/remote/assembly-contract.js';

const makeRuntime = () => createClusterMeshRuntime({
  generationId: 'rm0-gen-1',
  config: { capacity: { poolSize: 1 } },
  context: { async verify() { throw new Error('not invoked'); } },
  registration: { async authorize() { return { ok: false, reason: 'missing_registration' } as const; } },
  receipts: { append: vi.fn(async () => undefined) },
});

const makeBinding = (overrides: Partial<RemoteAuthorityBinding> = {}): RemoteAuthorityBinding => ({
  serviceId: 'remote',
  tier: 'preprod',
  meshId: 'remote-preprod',
  publicOrigin: 'https://preprod.remote.sent-tech.ca',
  trunkEndpoint: 'wss://preprod.remote.sent-tech.ca/trunk/v1',
  storage: { engine: 'postgres', storeMeshId: 'remote-preprod', allowedTenants: ['owner', 'isolation-fixture'], dedicatedAuditWriter: true },
  admissionReady: true,
  receiptPortReady: true,
  ...overrides,
});

const makeAppsModule = (enabled = true): ClusterMeshHonoNamespaceModule => ({
  namespace: '/apps',
  enabled,
  createRouter: () => new Hono()
    .post('/enrolment/v1/ceremony/open', (c) => c.json({ status: 'pending' }, 201))
    .post('/enrolment/v1/ceremony/poll', (c) => c.json({ status: 'pending' }))
    .post('/enrolment/v1/ceremony/approve', (c) => c.json({ status: 'approved' }))
    .post('/enrolment/v1/renew', (c) => c.json({ status: 'renewed' }))
    .post('/enrolment/v1/revoke', (c) => c.json({ status: 'revoked' })),
});

const makeUpgradeAdapter = (binding: RemoteAuthorityBinding): RemoteUpgradeAdapter => ({
  handleTrunkUpgrade: (request) => {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return { ok: false, status: 426, code: 'upgrade_required' };
    if (request.headers.get('cookie') || request.headers.get('origin')) return { ok: false, status: 400, code: 'forbidden_browser_headers' };
    const tenantId = request.headers.get('x-remote-tenant') ?? binding.tenantId ?? 'owner';
    const admitted = validateRemoteTenantAdmission(binding, tenantId);
    if (!admitted.ok) return { ok: false, status: 403, code: admitted.code };
    return { ok: true, path: '/trunk/v1', meshId: admitted.meshId, tenantId: admitted.tenantId };
  },
  handleBrowserUpgrade: (request) => {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return { ok: false, status: 426, code: 'upgrade_required' };
    if (request.headers.get('origin') !== binding.publicOrigin) return { ok: false, status: 403, code: 'invalid_origin' };
    if (!request.headers.get('cookie')?.includes('__Host-remote_session=')) return { ok: false, status: 401, code: 'missing_host_session_cookie' };
    const tenantId = request.headers.get('x-remote-tenant') ?? binding.tenantId ?? 'owner';
    const admitted = validateRemoteTenantAdmission(binding, tenantId);
    if (!admitted.ok) return { ok: false, status: 403, code: admitted.code };
    return { ok: true, path: '/ws/v1', meshId: admitted.meshId, tenantId: admitted.tenantId };
  },
});

describe('RM-0 (a) assembly proof: package-only Remote root and binding invariants', () => {
  it('mounts createClusterMeshPlugin at / with a single /apps module, /auth, UI, and both upgrades', async () => {
    const binding = makeBinding();
    const composed = composeRemoteRoot({
      runtime: makeRuntime(),
      binding,
      enrolmentModule: makeAppsModule(),
      authRouter: new Hono().get('/callback', (c) => c.json({ route: 'auth-callback' })),
      uiRouter: new Hono().get('/status', (c) => c.json({ route: 'remote-ui' })),
      upgradeAdapter: makeUpgradeAdapter(binding),
    });

    expect(composed.mountMap).toEqual(REMOTE_MOUNT_MAP_V1);
    expect((await composed.app.request('/enrolment/v1/ceremony/open', { method: 'POST' })).status).toBe(201);
    expect((await composed.app.request('/enrolment/v1/revoke', { method: 'POST' })).status).toBe(200);
    expect((await composed.app.request('/auth/callback')).status).toBe(200);
    expect((await composed.app.request('/status')).status).toBe(200);
    expect((await composed.app.request('/apps/enrolment/v1/ceremony/open', { method: 'POST' })).status).toBe(404);
    expect((await composed.app.request('/session/control/drive', { method: 'POST' })).status).toBe(404);

    const trunkOk = await composed.app.request('/trunk/v1', { headers: { upgrade: 'websocket' } });
    expect(trunkOk.status).toBe(200);
    await expect(trunkOk.json()).resolves.toMatchObject({ path: '/trunk/v1', meshId: 'remote-preprod', tenantId: 'owner' });

    const wsOk = await composed.app.request('/ws/v1', {
      headers: { upgrade: 'websocket', origin: binding.publicOrigin, cookie: '__Host-remote_session=ok' },
    });
    expect(wsOk.status).toBe(200);
    await expect(wsOk.json()).resolves.toMatchObject({ path: '/ws/v1', meshId: 'remote-preprod', tenantId: 'owner' });

    expect((await composed.app.request('/trunk/v1', { headers: { upgrade: 'websocket', origin: binding.publicOrigin } })).status).toBe(400);
    expect((await composed.app.request('/ws/v1', { headers: { upgrade: 'websocket', origin: 'https://evil.sent-tech.ca', cookie: '__Host-remote_session=ok' } })).status).toBe(403);
    expect((await composed.app.request('/ws/v1', { headers: { upgrade: 'websocket', origin: binding.publicOrigin } })).status).toBe(401);
  });

  it('refuses a second namespace mount, duplicate /apps, disabled /apps, or wrong mount override', () => {
    const binding = makeBinding();
    const base = {
      runtime: makeRuntime(), binding, enrolmentModule: makeAppsModule(),
      authRouter: new Hono(), uiRouter: new Hono(), upgradeAdapter: makeUpgradeAdapter(binding),
    };

    expect(() => composeRemoteRoot({ ...base, extraPluginNamespaces: [{ namespace: '/session', enabled: true, createRouter: () => new Hono() }] })).toThrow(RemoteAssemblyError);
    expect(() => composeRemoteRoot({ ...base, extraPluginNamespaces: [makeAppsModule()] })).toThrow(NamespaceRegistrationError);
    expect(() => composeRemoteRoot({ ...base, enrolmentModule: makeAppsModule(false) })).toThrow(/enrolment_module_disabled/);
    expect(() => composeRemoteRoot({ ...base, enrolmentModule: { namespace: '/health', enabled: true, createRouter: () => new Hono() } })).toThrow(/invalid_plugin_namespace/);
    expect(() => composeRemoteRoot({ ...base, mounts: { '/apps': '/api/v1' } })).toThrow(/invalid_plugin_mount/);
  });

  it('refuses invalid endpoint, mesh/storage mismatch, site-as-tenant confusion, and prod isolation-fixture', () => {
    expect(validateRemoteAuthorityBinding(makeBinding({ trunkEndpoint: 'ws://preprod.remote.sent-tech.ca/trunk/v1' }))).toMatchObject({ ok: false, code: 'invalid_trunk_endpoint' });
    expect(validateRemoteAuthorityBinding(makeBinding({ trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1' }))).toMatchObject({ ok: false, code: 'invalid_trunk_endpoint' });
    expect(validateRemoteAuthorityBinding(makeBinding({ tenantId: 'remote' }))).toMatchObject({ ok: false, code: 'site_name_used_as_tenant' });
    expect(validateRemoteAuthorityBinding(makeBinding({ tenantId: 'pages' }))).toMatchObject({ ok: false, code: 'site_name_used_as_tenant' });
    expect(validateRemoteAuthorityBinding(makeBinding({ tenantId: 'remote-preprod' }))).toMatchObject({ ok: false, code: 'site_name_used_as_tenant' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      tier: 'prod', meshId: 'remote-prod', publicOrigin: 'https://remote.sent-tech.ca',
      trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1', tenantId: 'isolation-fixture',
      storage: { engine: 'postgres', storeMeshId: 'remote-prod', allowedTenants: ['owner', 'isolation-fixture'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'isolation_fixture_forbidden_in_prod' });
    expect(validateRemoteAuthorityBinding(makeBinding({ tenantId: 'isolation-fixture' }))).toMatchObject({ ok: true });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'postgres', storeMeshId: 'remote-prod', allowedTenants: ['owner'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'mesh_storage_mismatch' });
    expect(validateRemoteAuthorityBinding(makeBinding({ admissionReady: false }))).toMatchObject({ ok: false, code: 'authority_not_ready' });
    expect(validateRemoteAuthorityBinding(makeBinding({ receiptPortReady: false }))).toMatchObject({ ok: false, code: 'receipt_port_not_ready' });
    expect(validateRemoteAuthorityBinding(makeBinding({ tier: 'staging' as RemoteTier }))).toMatchObject({ ok: false, code: 'invalid_tier' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      tier: 'prod', meshId: 'remote-prod', publicOrigin: 'https://remote.sent-tech.ca',
      trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1', tenantId: 'owner',
      storage: { engine: 'postgres', storeMeshId: 'remote-prod', allowedTenants: ['owner', 'isolation-fixture'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'isolation_fixture_forbidden_in_prod' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'postgres', storeMeshId: 'remote-preprod', allowedTenants: ['owner', 'remote'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'site_name_used_as_tenant' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'postgres', storeMeshId: 'remote-preprod', allowedTenants: [], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'invalid_allowed_tenants' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'postgres', storeMeshId: 'remote-preprod', allowedTenants: ['owner', 'owner'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'invalid_allowed_tenants' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      tier: 'prod', meshId: 'remote-prod', publicOrigin: 'https://remote.sent-tech.ca',
      trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1',
      storage: { engine: 'sqlite', allowSqliteForTest: true, storeMeshId: 'remote-prod', allowedTenants: ['owner'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'sqlite_forbidden_in_deployed_tier' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'sqlite', storeMeshId: 'remote-preprod', allowedTenants: ['owner'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: false, code: 'sqlite_forbidden_in_deployed_tier' });
    expect(validateRemoteAuthorityBinding(makeBinding({
      storage: { engine: 'sqlite', allowSqliteForTest: true, storeMeshId: 'remote-preprod', allowedTenants: ['owner'], dedicatedAuditWriter: true },
    }))).toMatchObject({ ok: true });

    const preprodProcess = makeBinding();
    expect(validateRemoteTenantAdmission(preprodProcess, 'owner')).toEqual({ ok: true, meshId: 'remote-preprod', tenantId: 'owner' });
    expect(validateRemoteTenantAdmission(preprodProcess, 'isolation-fixture')).toEqual({ ok: true, meshId: 'remote-preprod', tenantId: 'isolation-fixture' });
    expect(validateRemoteTenantAdmission(preprodProcess, 'stranger')).toMatchObject({ ok: false, code: 'tenant_not_allowed_in_store' });
    expect(validateRemoteTenantAdmission(preprodProcess, 'remote')).toMatchObject({ ok: false, code: 'site_name_used_as_tenant' });
  });
});
