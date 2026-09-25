import { pathToFileURL } from 'node:url';
import {
  isProviderModuleId,
  LLM_MESH_PACKAGE,
  LLM_MESH_RANGE,
  MODULE_CATALOG_INFO,
  PROVIDER_CATALOG,
  type PeerRequirement,
  type ProviderDescriptor,
} from './catalog.js';
import {
  CLUSTER_MESH_GATED_MODULE_IDS,
  CLUSTER_MESH_PROVIDER_MODULE_IDS,
  type ClusterMeshModuleId,
  type ClusterMeshModules,
  type ClusterMeshModulesOptions,
  type ModuleCapabilityMap,
  type ModuleCapabilityRecord,
} from './contracts.js';
import { ClusterMeshModuleUnavailableError, type ClusterMeshModuleUnavailableDetails } from './errors.js';
import { findInstalledPackage, physicalDirOf, resolveExportFile, type InstalledPackage } from './resolution.js';
import { satisfiesRange } from './semver.js';

const ALL_IDS: readonly ClusterMeshModuleId[] = [...CLUSTER_MESH_PROVIDER_MODULE_IDS, ...CLUSTER_MESH_GATED_MODULE_IDS];
const UNPROBED: ModuleCapabilityRecord = Object.freeze({ availability: 'gated', state: 'unprobed' });

/**
 * Test/qualification seam; public composition always anchors at the installed cluster-mesh.
 * Either way the registry imports the metadata-resolved physical file, never a bare provider
 * specifier, so the root graph carries no provider edge for a bundler to follow.
 */
export interface ModuleRegistryInternals {
  readonly anchorDir?: string;
}

interface Inspection {
  readonly entry: ProviderDescriptor;
  readonly pkg: InstalledPackage;
  readonly file: string;
  readonly peers: readonly { readonly peer: PeerRequirement; readonly pkg: InstalledPackage; readonly file: string }[];
}

type Refusal = Omit<ClusterMeshModuleUnavailableDetails, 'moduleId'>;

function versionOf(pkg: InstalledPackage): string | undefined {
  return typeof pkg.version === 'string' ? pkg.version : undefined;
}

function checkPackage(packageName: string, range: string, fromDir: string, subpath: string):
  { pkg: InstalledPackage; file: string } | Refusal {
  const pkg = findInstalledPackage(packageName, fromDir);
  if (!pkg) return { reason: 'not_installed', packageName, requiredRange: range };
  const installedVersion = versionOf(pkg);
  if (!satisfiesRange(pkg.version, range)) {
    return { reason: 'incompatible_version', packageName, requiredRange: range, ...(installedVersion ? { installedVersion } : {}) };
  }
  const file = resolveExportFile(pkg, subpath);
  if (!file) return { reason: 'export_unavailable', packageName, requiredRange: range, ...(installedVersion ? { installedVersion } : {}) };
  return { pkg, file };
}

const isRefusal = (value: object): value is Refusal => 'reason' in value;

function inspect(entry: ProviderDescriptor, anchorDir: string): Inspection | Refusal {
  const main = checkPackage(entry.packageName, entry.range, anchorDir, entry.subpath);
  if (isRefusal(main)) return main;
  if (entry.meshCoherence) {
    const gatewayMesh = findInstalledPackage(LLM_MESH_PACKAGE, main.pkg.dir);
    if (!gatewayMesh) return { reason: 'not_installed', packageName: LLM_MESH_PACKAGE, requiredRange: LLM_MESH_RANGE };
    const clusterMesh = findInstalledPackage(LLM_MESH_PACKAGE, anchorDir);
    const meshVersion = versionOf(gatewayMesh);
    if (!satisfiesRange(gatewayMesh.version, LLM_MESH_RANGE) || (clusterMesh && clusterMesh.dir !== gatewayMesh.dir)) {
      return {
        reason: 'incompatible_version', packageName: LLM_MESH_PACKAGE, requiredRange: LLM_MESH_RANGE,
        ...(meshVersion ? { installedVersion: meshVersion } : {}),
      };
    }
  }
  const peers: Inspection['peers'][number][] = [];
  for (const peer of entry.authPeers) {
    const owner = peer.resolveFrom ? peers.find((resolved) => resolved.peer.packageName === peer.resolveFrom) : undefined;
    const resolved = checkPackage(peer.packageName, peer.range, owner?.pkg.dir ?? main.pkg.dir, peer.subpath);
    if (isRefusal(resolved)) return resolved;
    peers.push({ peer, ...resolved });
  }
  return { entry, pkg: main.pkg, file: main.file, peers };
}

function missingMember(namespace: unknown, members: readonly string[]): boolean {
  if (typeof namespace !== 'object' || namespace === null) return true;
  return members.some((member) => (namespace as Record<string, unknown>)[member] === undefined);
}

export function createModuleRegistry(
  options: ClusterMeshModulesOptions = {},
  internals: ModuleRegistryInternals = {},
): ClusterMeshModules {
  const anchorDir = internals.anchorDir ?? physicalDirOf(import.meta.url);
  const importFile = (file: string): Promise<unknown> => import(pathToFileURL(file).href);
  const disabled = new Set<ClusterMeshModuleId>(options.disabled ?? []);
  const records = new Map<ClusterMeshModuleId, ModuleCapabilityRecord>();
  const pending = new Map<ClusterMeshModuleId, Promise<unknown>>();

  const refuse = (id: ClusterMeshModuleId, refusal: Refusal): ClusterMeshModuleUnavailableError => {
    const error = new ClusterMeshModuleUnavailableError({ moduleId: id, ...refusal });
    records.set(id, Object.freeze({
      availability: 'gated', state: 'unavailable', reason: error.reason,
      ...(error.packageName ? { packageName: error.packageName } : {}),
      ...(error.requiredRange ? { requiredRange: error.requiredRange } : {}),
      ...(error.installedVersion ? { installedVersion: error.installedVersion } : {}),
    }));
    return error;
  };

  const check = (id: ClusterMeshModuleId): Inspection | Refusal => {
    if (!isProviderModuleId(id)) return { reason: 'source_unavailable' };
    if (disabled.has(id)) return { reason: 'disabled' };
    return inspect(PROVIDER_CATALOG[id], anchorDir);
  };

  const evaluate = async (id: ClusterMeshModuleId, found: Inspection): Promise<unknown> => {
    const { entry, pkg } = found;
    let namespace: unknown;
    try {
      namespace = await importFile(found.file);
    } catch (cause) {
      throw refuse(id, { reason: 'load_failed', packageName: entry.packageName, requiredRange: entry.range, cause });
    }
    for (const { peer, file } of found.peers) {
      let peerNamespace: unknown;
      try {
        peerNamespace = await importFile(file);
      } catch (cause) {
        throw refuse(id, { reason: 'load_failed', packageName: peer.packageName, requiredRange: peer.range, cause });
      }
      if (missingMember(peerNamespace, peer.requiredMembers)) {
        throw refuse(id, { reason: 'export_unavailable', packageName: peer.packageName, requiredRange: peer.range });
      }
    }
    if (missingMember(namespace, entry.requiredMembers)) {
      throw refuse(id, { reason: 'export_unavailable', packageName: entry.packageName, requiredRange: entry.range });
    }
    records.set(id, Object.freeze({
      availability: 'available', state: 'loaded', packageName: entry.packageName, installedVersion: versionOf(pkg) ?? '',
    }));
    return namespace;
  };

  const snapshot = (): ModuleCapabilityMap => {
    const map = {} as Record<ClusterMeshModuleId, ModuleCapabilityRecord>;
    for (const id of ALL_IDS) map[id] = records.get(id) ?? UNPROBED;
    return Object.freeze(map);
  };

  return {
    load(id) {
      const existing = pending.get(id);
      if (existing) return existing;
      const found = check(id);
      const promise = isRefusal(found) ? Promise.reject(refuse(id, found)) : evaluate(id, found);
      pending.set(id, promise);
      return promise;
    },
    async probe() {
      for (const id of ALL_IDS) {
        if (records.get(id)?.state === 'loaded') continue;
        if (pending.has(id) && records.get(id)?.state === 'unavailable') continue;
        const found = check(id);
        if (isRefusal(found)) {
          refuse(id, found);
          continue;
        }
        records.set(id, Object.freeze({
          availability: 'available', state: 'installed',
          packageName: found.entry.packageName, installedVersion: versionOf(found.pkg) ?? '',
        }));
      }
      return snapshot();
    },
    snapshot,
    isEnabled(id) {
      return isProviderModuleId(id) && !disabled.has(id);
    },
    catalog() {
      return MODULE_CATALOG_INFO;
    },
  };
}

/** Create the lazy module registry for one composition root. Construction resolves nothing. */
export function createClusterMeshModules(options: ClusterMeshModulesOptions = {}): ClusterMeshModules {
  return createModuleRegistry(options);
}
