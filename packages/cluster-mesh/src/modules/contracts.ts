import type { ClusterMeshNamespace } from '@sentropic/contracts';
import type { ClusterMeshModuleUnavailableReason } from './errors.js';

/** Provider modules delivered by this release, each with a static leaf and a loader. */
export const CLUSTER_MESH_PROVIDER_MODULE_IDS = [
  'llm-mesh',
  'llm-mesh/facade',
  'llm-mesh/enrollment',
  'llm-mesh/node',
  'llm-mesh/transport/cloud-code',
  'gateway',
  'gateway/auth',
  'gateway/auth-hono',
] as const;

/** Catalogued capabilities not delivered by this release; always gated `source_unavailable`. */
export const CLUSTER_MESH_GATED_MODULE_IDS = [
  'mcp/auth',
  'mcp/auth/hono',
  'mcp/platform',
  'mcp/platform/hono',
  'mcp/platform/experimental',
  'mcp/platform/testing',
  'mcp/track',
  'auth-hono',
  'chat-server',
  'focus',
  'flow',
  'comments',
  'connector-host',
  'cli',
  'build-cli',
  'harness',
  'memory',
  'track-http',
  'mcp-broker',
  'mcp-connectors',
] as const;

export type ClusterMeshProviderModuleId = (typeof CLUSTER_MESH_PROVIDER_MODULE_IDS)[number];
export type ClusterMeshGatedModuleId = (typeof CLUSTER_MESH_GATED_MODULE_IDS)[number];
export type ClusterMeshModuleId = ClusterMeshProviderModuleId | ClusterMeshGatedModuleId;

export type ModuleCapabilityRecord =
  | { readonly availability: 'gated'; readonly state: 'unprobed' }
  | {
    readonly availability: 'available';
    readonly state: 'installed' | 'loaded';
    readonly packageName: string;
    readonly installedVersion: string;
  }
  | {
    readonly availability: 'gated';
    readonly state: 'unavailable';
    readonly reason: ClusterMeshModuleUnavailableReason;
    readonly packageName?: string;
    readonly requiredRange?: string;
    readonly installedVersion?: string;
  };

export type ModuleCapabilityMap = Readonly<Record<ClusterMeshModuleId, ModuleCapabilityRecord>>;

export interface ClusterMeshModuleInfo {
  readonly id: ClusterMeshModuleId;
  readonly owner: string;
  readonly status: 'delivered' | 'source_unavailable';
  /** Public provider entry, for delivered modules. */
  readonly entry?: string;
  readonly requiredRange?: string;
  /** Optional peers selected by this module and resolved from the gateway package. */
  readonly peers?: readonly { readonly packageName: string; readonly entry: string; readonly requiredRange: string }[];
  readonly namespace?: ClusterMeshNamespace;
}

export interface ClusterMeshModulesOptions {
  /** Delivered modules the composition root refuses to acquire (`disabled`). */
  readonly disabled?: readonly ClusterMeshModuleId[];
}

/** One registry per composition root; no process-global service singleton. */
export interface ClusterMeshModules {
  /** Untyped acquisition; typed loaders live under `@sentropic/cluster-mesh/loaders/*`. */
  load(id: ClusterMeshModuleId): Promise<unknown>;
  /** Metadata-only availability; never evaluates provider code. */
  probe(): Promise<ModuleCapabilityMap>;
  snapshot(): ModuleCapabilityMap;
  isEnabled(id: ClusterMeshModuleId): boolean;
  catalog(): readonly ClusterMeshModuleInfo[];
}
