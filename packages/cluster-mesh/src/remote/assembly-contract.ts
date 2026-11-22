import type { ClusterMeshNamespace } from '@sentropic/contracts';
import { Hono } from 'hono';
import { createClusterMeshPlugin, type ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { ClusterMeshRuntime } from '../runtime/generation.js';
import { createNamespaceRegistry } from '../runtime/namespace-registry.js';

export const REMOTE_MOUNT_MAP_V1 = Object.freeze({
  root: '/',
  pluginNamespace: '/apps' as const,
  pluginMount: '/',
  enrolmentBase: '/enrolment/v1',
  authBase: '/auth',
  trunkUpgradePath: '/trunk/v1',
  browserUpgradePath: '/ws/v1',
});

export type RemoteTier = 'preprod' | 'prod';
export type RemoteMeshId = 'remote-preprod' | 'remote-prod';

export interface RemoteStorageProfile {
  readonly engine: 'postgres' | 'sqlite';
  readonly storeMeshId: string;
  readonly allowedTenants: readonly string[];
  readonly dedicatedAuditWriter: boolean;
  readonly allowSqliteForTest?: boolean;
}

export interface RemoteAuthorityBinding {
  readonly serviceId: 'remote';
  readonly tier: RemoteTier;
  readonly meshId: RemoteMeshId;
  readonly publicOrigin: string;
  readonly trunkEndpoint: string;
  readonly tenantId?: string;
  readonly storage: RemoteStorageProfile;
  readonly admissionReady: boolean;
  readonly receiptPortReady: boolean;
}

export type RemoteBindingRefusalCode =
  | 'invalid_tier' | 'invalid_service_id' | 'invalid_mesh_id' | 'invalid_public_origin' | 'invalid_trunk_endpoint'
  | 'invalid_tenant_id' | 'site_name_used_as_tenant' | 'isolation_fixture_forbidden_in_prod'
  | 'sqlite_forbidden_in_deployed_tier' | 'invalid_allowed_tenants'
  | 'mesh_storage_mismatch' | 'tenant_not_allowed_in_store' | 'audit_writer_not_dedicated'
  | 'authority_not_ready' | 'receipt_port_not_ready';

export type RemoteBindingValidationResult =
  | { readonly ok: true; readonly binding: Readonly<RemoteAuthorityBinding> }
  | { readonly ok: false; readonly code: RemoteBindingRefusalCode; readonly reason: string };

export type RemoteTenantAdmissionResult =
  | { readonly ok: true; readonly meshId: RemoteMeshId; readonly tenantId: string }
  | { readonly ok: false; readonly code: RemoteBindingRefusalCode; readonly reason: string };

export type RemoteUpgradeResult =
  | {
      readonly ok: true;
      readonly path: '/trunk/v1' | '/ws/v1';
      readonly meshId: string;
      readonly tenantId: string;
      readonly response?: Response;
    }
  | { readonly ok: false; readonly status: 400 | 401 | 403 | 426 | 429 | 503; readonly code: string };

export interface RemoteUpgradeAdapter {
  handleTrunkUpgrade(request: Request): RemoteUpgradeResult | Promise<RemoteUpgradeResult>;
  handleBrowserUpgrade(request: Request): RemoteUpgradeResult | Promise<RemoteUpgradeResult>;
}

export class RemoteAssemblyError extends Error {
  readonly code: string;
  constructor(code: string, reason: string) {
    super(`${code}: ${reason}`);
    this.name = 'RemoteAssemblyError';
    this.code = code;
  }
}

const RESERVED_NON_TENANT_NAMES = new Set([
  'remote', 'pages', 'remote-prod', 'remote-preprod', 'pages-prod', 'pages-preprod',
]);

const TIER_SPECS: Readonly<Record<RemoteTier, {
  readonly meshId: RemoteMeshId;
  readonly publicOrigin: string;
  readonly trunkEndpoint: string;
}>> = {
  preprod: {
    meshId: 'remote-preprod',
    publicOrigin: 'https://preprod.remote.sent-tech.ca',
    trunkEndpoint: 'wss://preprod.remote.sent-tech.ca/trunk/v1',
  },
  prod: {
    meshId: 'remote-prod',
    publicOrigin: 'https://remote.sent-tech.ca',
    trunkEndpoint: 'wss://remote.sent-tech.ca/trunk/v1',
  },
};

function validateTenantIdForTier(
  tier: RemoteTier,
  meshId: RemoteMeshId,
  tenantId: string,
): { readonly ok: false; readonly code: RemoteBindingRefusalCode; readonly reason: string } | null {
  if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId !== tenantId.trim()) {
    return { ok: false, code: 'invalid_tenant_id', reason: 'tenantId must be a non-empty trimmed string' };
  }
  if (RESERVED_NON_TENANT_NAMES.has(tenantId) || tenantId === meshId) {
    return { ok: false, code: 'site_name_used_as_tenant', reason: `tenantId ${tenantId} collides with a mesh or site name (WET-2 clause 1)` };
  }
  if (tier === 'prod' && tenantId === 'isolation-fixture') {
    return { ok: false, code: 'isolation_fixture_forbidden_in_prod', reason: 'isolation-fixture is test/preprod-only' };
  }
  return null;
}

export function validateRemoteAuthorityBinding(binding: RemoteAuthorityBinding): RemoteBindingValidationResult {
  if (!Object.hasOwn(TIER_SPECS, binding.tier)) {
    return { ok: false, code: 'invalid_tier', reason: `unsupported Remote tier ${String(binding.tier)}` };
  }
  const expected = TIER_SPECS[binding.tier];
  if (binding.serviceId !== 'remote') return { ok: false, code: 'invalid_service_id', reason: 'serviceId must be remote' };
  if (binding.meshId !== expected.meshId) return { ok: false, code: 'invalid_mesh_id', reason: `tier ${binding.tier} requires mesh ${expected.meshId}` };
  if (binding.publicOrigin !== expected.publicOrigin) return { ok: false, code: 'invalid_public_origin', reason: `origin must equal ${expected.publicOrigin}` };
  if (binding.trunkEndpoint !== expected.trunkEndpoint) return { ok: false, code: 'invalid_trunk_endpoint', reason: `endpoint must equal ${expected.trunkEndpoint}` };
  if (binding.storage.engine !== 'postgres') {
    const sqliteAllowed = binding.tier === 'preprod'
      && binding.storage.engine === 'sqlite'
      && binding.storage.allowSqliteForTest === true;
    if (!sqliteAllowed) {
      return { ok: false, code: 'sqlite_forbidden_in_deployed_tier', reason: `tier ${binding.tier} requires postgres storage` };
    }
  }
  if (binding.storage.storeMeshId !== binding.meshId) return { ok: false, code: 'mesh_storage_mismatch', reason: 'storage mesh does not match authority mesh' };
  if (!Array.isArray(binding.storage.allowedTenants) || binding.storage.allowedTenants.length === 0) {
    return { ok: false, code: 'invalid_allowed_tenants', reason: 'storage.allowedTenants must contain at least one tenant' };
  }
  const seenTenants = new Set<string>();
  for (const tenant of binding.storage.allowedTenants) {
    const refusal = validateTenantIdForTier(binding.tier, binding.meshId, tenant);
    if (refusal) return refusal;
    if (seenTenants.has(tenant)) {
      return { ok: false, code: 'invalid_allowed_tenants', reason: `duplicate tenant ${tenant} in storage.allowedTenants` };
    }
    seenTenants.add(tenant);
  }
  if (binding.tenantId !== undefined) {
    const refusal = validateTenantIdForTier(binding.tier, binding.meshId, binding.tenantId);
    if (refusal) return refusal;
    if (!seenTenants.has(binding.tenantId)) {
      return { ok: false, code: 'tenant_not_allowed_in_store', reason: 'tenant not admitted in tier storage' };
    }
  }
  if (!binding.storage.dedicatedAuditWriter) return { ok: false, code: 'audit_writer_not_dedicated', reason: 'audit writer must be outside app writer role' };
  if (!binding.admissionReady) return { ok: false, code: 'authority_not_ready', reason: 'admission port is not ready' };
  if (!binding.receiptPortReady) return { ok: false, code: 'receipt_port_not_ready', reason: 'receipt port is not ready' };
  return {
    ok: true,
    binding: Object.freeze({
      ...binding,
      storage: Object.freeze({ ...binding.storage, allowedTenants: Object.freeze([...binding.storage.allowedTenants]) }),
    }),
  };
}

export function validateRemoteTenantAdmission(
  binding: RemoteAuthorityBinding,
  tenantId: string,
): RemoteTenantAdmissionResult {
  const validated = validateRemoteAuthorityBinding(binding);
  if (!validated.ok) return validated;
  const refusal = validateTenantIdForTier(binding.tier, binding.meshId, tenantId);
  if (refusal) return refusal;
  if (!binding.storage.allowedTenants.includes(tenantId)) {
    return { ok: false, code: 'tenant_not_allowed_in_store', reason: `tenant ${tenantId} not admitted in ${binding.meshId} store` };
  }
  return { ok: true, meshId: binding.meshId, tenantId };
}

export interface ComposeRemoteRootOptions {
  readonly runtime: ClusterMeshRuntime;
  readonly binding: RemoteAuthorityBinding;
  readonly enrolmentModule: ClusterMeshHonoNamespaceModule;
  readonly authRouter: Hono;
  readonly uiRouter: Hono;
  readonly upgradeAdapter: RemoteUpgradeAdapter;
  readonly mounts?: Partial<Record<ClusterMeshNamespace, string>>;
  readonly extraPluginNamespaces?: readonly ClusterMeshHonoNamespaceModule[];
}

export function composeRemoteRoot(options: ComposeRemoteRootOptions) {
  const validated = validateRemoteAuthorityBinding(options.binding);
  if (!validated.ok) throw new RemoteAssemblyError(validated.code, validated.reason);
  if (options.enrolmentModule.namespace !== REMOTE_MOUNT_MAP_V1.pluginNamespace) {
    throw new RemoteAssemblyError('invalid_plugin_namespace', 'Remote root permits only the /apps namespace module');
  }
  if (!options.enrolmentModule.enabled) throw new RemoteAssemblyError('enrolment_module_disabled', '/apps enrolment module must be enabled');
  const mounts = options.mounts ?? { '/apps': '/' };
  if (Object.keys(mounts).length !== 1 || mounts['/apps'] !== '/') {
    throw new RemoteAssemblyError('invalid_plugin_mount', 'Remote root requires exact mounts: { "/apps": "/" }');
  }
  const namespaces = [options.enrolmentModule, ...(options.extraPluginNamespaces ?? [])];
  createNamespaceRegistry(namespaces);
  if (namespaces.length > 1) throw new RemoteAssemblyError('multiple_namespace_mounts_forbidden', 'Remote root allows exactly one /apps namespace module');
  const plugin = createClusterMeshPlugin({ runtime: options.runtime, namespaces, mounts });

  const app = new Hono();
  app.route(REMOTE_MOUNT_MAP_V1.authBase, options.authRouter);
  app.get(REMOTE_MOUNT_MAP_V1.trunkUpgradePath, async (c) => {
    const decision = await options.upgradeAdapter.handleTrunkUpgrade(c.req.raw);
    return decision.ok ? (decision.response ?? c.json(decision, 200)) : c.json({ error: decision.code }, decision.status);
  });
  app.get(REMOTE_MOUNT_MAP_V1.browserUpgradePath, async (c) => {
    const decision = await options.upgradeAdapter.handleBrowserUpgrade(c.req.raw);
    return decision.ok ? (decision.response ?? c.json(decision, 200)) : c.json({ error: decision.code }, decision.status);
  });
  app.route('/', plugin);
  app.route('/', options.uiRouter);
  return { app, binding: validated.binding, mountMap: REMOTE_MOUNT_MAP_V1 };
}
