import { LLM_GATEWAY_PACKAGE, LLM_GATEWAY_RANGE, LLM_MESH_PACKAGE, LLM_MESH_RANGE } from './catalog.js';
import { findInstalledPackage, findOwningPackageDir, physicalDirOf } from './resolution.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { satisfiesRange } from './semver.js';

export const CLUSTER_MESH_TOPOLOGY_INVALID = 'cluster_mesh_topology_invalid' as const;
const CLUSTER_MESH_PACKAGE = '@sentropic/cluster-mesh';
const INSTANCES_KEY = Symbol.for('@sentropic/cluster-mesh/instances');

export type ClusterMeshTopologyReason = 'duplicate_instance' | 'divergent_llm_mesh' | 'incompatible_version' | 'not_installed';

/**
 * Startup refusal for an invalid per-process installation topology. Unlike module
 * refusals, the message names the conflicting physical paths for the operator.
 * Recognize it by `code` (see `isClusterMeshTopologyError`), not by `instanceof`.
 */
export class ClusterMeshTopologyError extends Error {
  readonly code = CLUSTER_MESH_TOPOLOGY_INVALID;
  constructor(readonly reason: ClusterMeshTopologyReason, readonly paths: readonly string[], detail: string) {
    super(`Cluster Mesh topology is invalid (${reason}): ${detail}`);
    this.name = 'ClusterMeshTopologyError';
  }
}

export function isClusterMeshTopologyError(value: unknown): value is ClusterMeshTopologyError {
  return typeof value === 'object' && value !== null
    && (value as { code?: unknown }).code === CLUSTER_MESH_TOPOLOGY_INVALID
    && typeof (value as { reason?: unknown }).reason === 'string';
}

export interface ClusterMeshInstanceEntry {
  /** Unique per evaluated copy; duplicates are counted by token, not by path. */
  readonly token: symbol;
  readonly moduleUrl: string;
}

export interface TopologyPackage {
  readonly path: string;
  readonly version?: string;
}

export interface ClusterMeshTopologyReport {
  readonly instances: readonly TopologyPackage[];
  readonly llmMesh?: TopologyPackage;
  readonly gateway?: TopologyPackage & { readonly llmMesh?: TopologyPackage };
}

export interface VerifyClusterMeshTopologyOptions {
  /** Providers that must be installed and coherent (default: none). */
  readonly require?: readonly ('llm-mesh' | 'gateway')[];
}

function instanceRegistry(): ClusterMeshInstanceEntry[] {
  const store = globalThis as unknown as Record<symbol, ClusterMeshInstanceEntry[] | undefined>;
  let entries = store[INSTANCES_KEY];
  if (!Array.isArray(entries)) {
    entries = [];
    Object.defineProperty(globalThis, INSTANCES_KEY, { value: entries, enumerable: false, configurable: true });
  }
  return entries;
}

// Module evaluation registers this copy exactly once.
const THIS_INSTANCE: ClusterMeshInstanceEntry = Object.freeze({ token: Symbol('cluster-mesh-instance'), moduleUrl: import.meta.url });
instanceRegistry().push(THIS_INSTANCE);

function versionAt(dir: string): string | undefined {
  try {
    const version: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function describeInstance(entry: ClusterMeshInstanceEntry): TopologyPackage {
  const moduleDir = physicalDirOf(entry.moduleUrl);
  const path = findOwningPackageDir(moduleDir, CLUSTER_MESH_PACKAGE) ?? moduleDir;
  const version = versionAt(path);
  return version ? { path, version } : { path };
}

const label = (pkg: TopologyPackage): string => `${pkg.path}${pkg.version ? `@${pkg.version}` : ''}`;

export interface InspectTopologyInput extends VerifyClusterMeshTopologyOptions {
  readonly anchorDir: string;
  readonly instances: readonly ClusterMeshInstanceEntry[];
  /** Explicit preflight also enforces accepted ranges; the automatic guard checks identity only. */
  readonly strict: boolean;
}

/** Metadata-only inspection; never imports a provider. Throws `ClusterMeshTopologyError`. */
export function inspectTopology(input: InspectTopologyInput): ClusterMeshTopologyReport {
  const tokens = new Set(input.instances.map((entry) => entry.token));
  const instances = input.instances.map(describeInstance);
  if (tokens.size > 1) {
    throw new ClusterMeshTopologyError('duplicate_instance', instances.map((entry) => entry.path),
      `${tokens.size} evaluated @sentropic/cluster-mesh copies in one process: ${instances.map(label).join(', ')}`);
  }
  const required = new Set(input.require ?? []);
  const mesh = findInstalledPackage(LLM_MESH_PACKAGE, input.anchorDir);
  const gateway = findInstalledPackage(LLM_GATEWAY_PACKAGE, input.anchorDir);
  const gatewayMesh = gateway ? findInstalledPackage(LLM_MESH_PACKAGE, gateway.dir) : undefined;
  const pkg = (found: { dir: string; version: unknown }): TopologyPackage =>
    (typeof found.version === 'string' ? { path: found.dir, version: found.version } : { path: found.dir });
  if (mesh && gatewayMesh && mesh.dir !== gatewayMesh.dir) {
    throw new ClusterMeshTopologyError('divergent_llm_mesh', [mesh.dir, gatewayMesh.dir],
      `${LLM_MESH_PACKAGE} resolves to ${label(pkg(mesh))} from cluster-mesh but ${label(pkg(gatewayMesh))} from ${LLM_GATEWAY_PACKAGE}`);
  }
  if (input.strict) {
    for (const name of ['llm-mesh', 'gateway'] as const) {
      const found = name === 'llm-mesh' ? mesh : gateway;
      if (!found && required.has(name)) {
        throw new ClusterMeshTopologyError('not_installed', [],
          `${name === 'llm-mesh' ? LLM_MESH_PACKAGE : LLM_GATEWAY_PACKAGE} is not reachable from cluster-mesh`);
      }
    }
    const ranged: [typeof mesh, string, string][] = [
      [mesh, LLM_MESH_PACKAGE, LLM_MESH_RANGE], [gateway, LLM_GATEWAY_PACKAGE, LLM_GATEWAY_RANGE],
      [gatewayMesh, LLM_MESH_PACKAGE, LLM_MESH_RANGE],
    ];
    for (const [found, name, range] of ranged) {
      if (found && !satisfiesRange(found.version, range)) {
        throw new ClusterMeshTopologyError('incompatible_version', [found.dir],
          `${name} at ${label(pkg(found))} does not satisfy "${range}"`);
      }
    }
    if (gateway && !gatewayMesh) {
      throw new ClusterMeshTopologyError('not_installed', [gateway.dir],
        `${LLM_MESH_PACKAGE} is not reachable from ${LLM_GATEWAY_PACKAGE} at ${gateway.dir}`);
    }
  }
  return {
    instances,
    ...(mesh ? { llmMesh: pkg(mesh) } : {}),
    ...(gateway ? { gateway: { ...pkg(gateway), ...(gatewayMesh ? { llmMesh: pkg(gatewayMesh) } : {}) } } : {}),
  };
}

const ANCHOR_DIR = physicalDirOf(import.meta.url);
let memo: { count: number; outcome: { report: ClusterMeshTopologyReport } | { error: unknown } } | undefined;

/** Automatic per-process guard run by every leaf, loader and compose entry; memoized per copy count. */
export function assertClusterMeshTopology(): void {
  const instances = instanceRegistry();
  if (memo?.count !== instances.length) {
    try {
      memo = { count: instances.length, outcome: { report: inspectTopology({ anchorDir: ANCHOR_DIR, instances, strict: false }) } };
    } catch (error) {
      memo = { count: instances.length, outcome: { error } };
    }
  }
  if ('error' in memo.outcome) throw memo.outcome.error;
}

/**
 * Explicit startup preflight: one evaluated cluster-mesh copy, one llm-mesh shared
 * with the installed gateway, and accepted ranges. Call it before binding a listener.
 */
export function verifyClusterMeshTopology(options: VerifyClusterMeshTopologyOptions = {}): ClusterMeshTopologyReport {
  return inspectTopology({ anchorDir: ANCHOR_DIR, instances: instanceRegistry(), strict: true, ...options });
}
