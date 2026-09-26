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

/** Module URL without `?query`/`#hash`: re-evaluations of one file share it; distinct copies do not. */
export function normalizeModuleUrl(moduleUrl: string): string {
  return moduleUrl.replace(/[?#].*$/su, '');
}

/**
 * Register one evaluated copy. Re-evaluating the same file (HMR, Vite dev, `vi.resetModules`,
 * cache-busting queries) replaces its entry; a different URL (nested copy, `npm link`,
 * `--preserve-symlinks` link path, pnpm variant) adds one and is reported as a duplicate.
 */
export function registerClusterMeshInstance(registry: ClusterMeshInstanceEntry[], entry: ClusterMeshInstanceEntry): void {
  const url = normalizeModuleUrl(entry.moduleUrl);
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    if (normalizeModuleUrl(registry[index]!.moduleUrl) === url) registry.splice(index, 1);
  }
  registry.push(entry);
}

// Module evaluation registers this copy exactly once.
const THIS_INSTANCE: ClusterMeshInstanceEntry = Object.freeze({ token: Symbol('cluster-mesh-instance'), moduleUrl: import.meta.url });
registerClusterMeshInstance(instanceRegistry(), THIS_INSTANCE);

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

/** Provider family of a guarded leaf, loader or compose entry. */
export type ClusterMeshLeafFamily = 'llm-mesh' | 'gateway';

export interface InspectTopologyInput extends VerifyClusterMeshTopologyOptions {
  readonly anchorDir: string;
  readonly instances: readonly ClusterMeshInstanceEntry[];
  /** Explicit preflight: every accepted range, plus the `require` list. */
  readonly strict: boolean;
  /**
   * Automatic guard: accepted ranges of the installed providers of this family (`gateway` also covers
   * llm-mesh). An absent provider is not checked here; its leaf import fails on its own.
   */
  readonly family?: ClusterMeshLeafFamily;
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
  }
  // Ranges are checked on the copies this cluster-mesh actually resolves: llm-mesh and llm-gateway from its
  // own physical location, the gateway's llm-mesh from the gateway's physical location.
  const families: readonly ClusterMeshLeafFamily[] = input.strict || input.family === 'gateway'
    ? ['llm-mesh', 'gateway'] : input.family ? [input.family] : [];
  const ranged: [typeof mesh, string, string, ClusterMeshLeafFamily][] = [
    [mesh, LLM_MESH_PACKAGE, LLM_MESH_RANGE, 'llm-mesh'], [gateway, LLM_GATEWAY_PACKAGE, LLM_GATEWAY_RANGE, 'gateway'],
    [gatewayMesh, LLM_MESH_PACKAGE, LLM_MESH_RANGE, 'llm-mesh'],
  ];
  for (const [found, name, range, family] of ranged) {
    if (found && families.includes(family) && !satisfiesRange(found.version, range)) {
      throw new ClusterMeshTopologyError('incompatible_version', [found.dir],
        `installed ${name}@${String(found.version ?? 'unknown')} at ${found.dir} does not satisfy the required range "${range}"`);
    }
  }
  if (input.strict && gateway && !gatewayMesh) {
    throw new ClusterMeshTopologyError('not_installed', [gateway.dir],
      `${LLM_MESH_PACKAGE} is not reachable from ${LLM_GATEWAY_PACKAGE} at ${gateway.dir}`);
  }
  return {
    instances,
    ...(mesh ? { llmMesh: pkg(mesh) } : {}),
    ...(gateway ? { gateway: { ...pkg(gateway), ...(gatewayMesh ? { llmMesh: pkg(gatewayMesh) } : {}) } } : {}),
  };
}

const ANCHOR_DIR = physicalDirOf(import.meta.url);
type GuardOutcome = { report: ClusterMeshTopologyReport } | { error: unknown };
let memo: { tokens: readonly symbol[]; outcomes: Map<string, GuardOutcome> } | undefined;

const sameTokens = (a: readonly symbol[], b: readonly ClusterMeshInstanceEntry[]): boolean =>
  a.length === b.length && b.every((entry, index) => entry.token === a[index]);

/**
 * Automatic guard run by every leaf, loader and compose entry: one evaluated copy, one llm-mesh shared
 * with the gateway, and the accepted ranges of the entry's provider family. Memoized per registered copy
 * set and family. State lives on `globalThis`, so it is per thread (each worker_thread has its own registry).
 */
export function assertClusterMeshTopology(family?: ClusterMeshLeafFamily): void {
  const instances = instanceRegistry();
  if (!memo || !sameTokens(memo.tokens, instances)) memo = { tokens: instances.map((entry) => entry.token), outcomes: new Map() };
  const key = family ?? 'identity';
  let outcome = memo.outcomes.get(key);
  if (!outcome) {
    try {
      outcome = { report: inspectTopology({ anchorDir: ANCHOR_DIR, instances, strict: false, ...(family ? { family } : {}) }) };
    } catch (error) {
      outcome = { error };
    }
    memo.outcomes.set(key, outcome);
  }
  if ('error' in outcome) throw outcome.error;
}

/**
 * Explicit startup preflight: one evaluated cluster-mesh copy, one llm-mesh shared
 * with the installed gateway, accepted ranges of both providers and `require`. Optional: every leaf
 * already runs the automatic guard; call it to fail before mounting routes that import no leaf.
 */
export function verifyClusterMeshTopology(options: VerifyClusterMeshTopologyOptions = {}): ClusterMeshTopologyReport {
  return inspectTopology({ anchorDir: ANCHOR_DIR, instances: instanceRegistry(), strict: true, ...options });
}
