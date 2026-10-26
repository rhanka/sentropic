import type { ClusterMeshNamespace } from '@sentropic/contracts';
import {
  CLUSTER_MESH_GATED_MODULE_IDS,
  type ClusterMeshGatedModuleId,
  type ClusterMeshModuleInfo,
  type ClusterMeshProviderModuleId,
} from './contracts.js';

export const LLM_MESH_PACKAGE = '@sentropic/llm-mesh';
export const LLM_GATEWAY_PACKAGE = '@sentropic/llm-gateway';
export const MCP_PLATFORM_PACKAGE = '@sentropic/mcp-platform';
/** Native wire validation and host-owned stateful wrapping require the 0.4 family. */
export const MCP_PLATFORM_RANGE = '>=0.4.0 <0.5.0';
export const ARTIFACTS_PACKAGE = '@sentropic/artifacts';
/** Artifacts 0.1.3 admits the platform 0.4 family used by native wrapping. */
export const ARTIFACTS_RANGE = '>=0.2.0 <0.3.0';
export const LLM_MESH_RANGE = '0.19.2 || >=0.22.0 <0.29.0';
export const LLM_MESH_SPEECH_RANGE = '>=0.28.0 <0.29.0';
export const LLM_GATEWAY_RANGE = '>=0.19.0 <0.22.0';
export const MCP_AUTH_RANGE = '>=0.2.1 <0.3.0';
export const JOSE_RANGE = '^5.10.0';
/** Follows llm-gateway's declared optional peer range, including the Zod 4 auth-hono release.
 * Spelled as a bounded interval: the minimal release-range parser has no `||`. */
export const AUTH_HONO_RANGE = '>=0.15.0 <0.18.0';
export const COMMENTS_RANGE = '^0.3.0';

export interface PeerRequirement {
  readonly packageName: string;
  readonly subpath: string;
  readonly range: string;
  readonly requiredMembers: readonly string[];
  /** Resolve from this already-resolved peer's package (its owner), not from the gateway. */
  readonly resolveFrom?: string;
}

export interface ProviderDescriptor {
  readonly id: ClusterMeshProviderModuleId;
  readonly owner: string;
  readonly packageName: string;
  readonly subpath: string;
  readonly range: string;
  readonly requiredMembers: readonly string[];
  readonly namespace?: ClusterMeshNamespace;
  /** Gateway family: validate the gateway's llm-mesh instance against cluster-mesh's. */
  readonly meshCoherence: boolean;
  /** Deferred auth peers resolved and preloaded from the gateway package. */
  readonly authPeers: readonly PeerRequirement[];
}

// No provider specifier is ever imported from the root graph: the registry imports the
// metadata-resolved physical file, so bundling the root never pulls a provider in.
const SERVICE_AUTH_PEERS: readonly PeerRequirement[] = [
  { packageName: '@sentropic/mcp-auth', subpath: './hono', range: MCP_AUTH_RANGE, requiredMembers: ['createRequireServiceAuth'] },
  // jose is mcp-auth's peer: resolve it from mcp-auth, which is what imports it.
  { packageName: 'jose', subpath: '.', range: JOSE_RANGE, requiredMembers: ['jwtVerify'], resolveFrom: '@sentropic/mcp-auth' },
];
const SESSION_AUTH_PEERS: readonly PeerRequirement[] = [
  { packageName: '@sentropic/auth-hono', subpath: './middleware', range: AUTH_HONO_RANGE, requiredMembers: ['createRequireAuth'] },
];

const mesh = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[],
  namespace?: ClusterMeshNamespace): ProviderDescriptor => ({
  id, owner: 'llm-mesh', packageName: LLM_MESH_PACKAGE, subpath, range: LLM_MESH_RANGE, requiredMembers,
  meshCoherence: false, authPeers: [], ...(namespace ? { namespace } : {}),
});
const gateway = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[],
  authPeers: readonly PeerRequirement[], namespace?: ClusterMeshNamespace): ProviderDescriptor => ({
  id, owner: 'llm-gateway', packageName: LLM_GATEWAY_PACKAGE, subpath, range: LLM_GATEWAY_RANGE, requiredMembers,
  meshCoherence: true, authPeers, ...(namespace ? { namespace } : {}),
});
const mcpPlatform = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[]): ProviderDescriptor => ({
  id, owner: 'mcp-platform', packageName: MCP_PLATFORM_PACKAGE, subpath, range: MCP_PLATFORM_RANGE, requiredMembers,
  meshCoherence: false, authPeers: [],
});
const artifacts = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[]): ProviderDescriptor => ({
  id, owner: 'artifacts', packageName: ARTIFACTS_PACKAGE, subpath, range: ARTIFACTS_RANGE, requiredMembers,
  meshCoherence: false, authPeers: [],
});

export const PROVIDER_CATALOG: Readonly<Record<ClusterMeshProviderModuleId, ProviderDescriptor>> = {
  speech: { ...mesh('speech', './speech', ['getModelSpeechCapabilities', 'negotiateSpeech']),
    range: LLM_MESH_SPEECH_RANGE },
  'llm-mesh': mesh('llm-mesh', '.', ['createLlmMesh', 'createProviderRegistry'], '/llm-mesh'),
  'llm-mesh/facade': mesh('llm-mesh/facade', './facade', ['createLlmMeshFacade']),
  'llm-mesh/enrollment': mesh('llm-mesh/enrollment', './enrollment', []),
  'llm-mesh/node': mesh('llm-mesh/node', './node', ['InMemoryKeyring']),
  'llm-mesh/decision': mesh('llm-mesh/decision', './decision', ['createRemoteDecisionClient', 'validateDecisionResult']),
  'llm-mesh/decision/host': mesh('llm-mesh/decision/host', './decision/host', ['createDecisionService', 'createJevAdapter', 'createStructuredDecisionAdapter', 'jevDescriptor']),
  'llm-mesh/transport/jev': mesh('llm-mesh/transport/jev', './transport/jev', ['createJevTransport']),
  'llm-mesh/transport/cloud-code': mesh('llm-mesh/transport/cloud-code', './transport/cloud-code', ['CloudCodeProviderAdapter']),
  gateway: gateway('gateway', '.', ['createGatewayRouter'], [], '/gw'),
  'gateway/auth': gateway('gateway/auth', './auth', ['ServiceAuthVerifyToken'], SERVICE_AUTH_PEERS),
  'gateway/auth-hono': gateway('gateway/auth-hono', './auth-hono', ['AuthHonoVerifyToken'], SESSION_AUTH_PEERS),
  'mcp-platform/registry': mcpPlatform('mcp-platform/registry', './registry', ['createProviderRegistry']),
  'mcp-platform/entry': mcpPlatform('mcp-platform/entry', './registry/entry', ['buildRegistryEntry', 'resolveRegistryEntry']),
  'mcp-platform/bridge': mcpPlatform('mcp-platform/bridge', './transport/bridge', ['registerBridgeTools', 'registerMcpWireTools', 'identityFromExtra']),
  'mcp-platform/tool-schemas': mcpPlatform('mcp-platform/tool-schemas', './transport/tool-schemas', ['compileMcpToolSchemas']),
  'mcp-platform/result-codec': mcpPlatform('mcp-platform/result-codec', './transport/result-codec', ['validateMcpWireResult']),
  'mcp-platform/hono': mcpPlatform('mcp-platform/hono', './hono', ['createMcpPlatformHono']),
  'mcp-platform/stdio': mcpPlatform('mcp-platform/stdio', './transport/stdio', ['createStdioTransport', 'extractStdioRequestIdentity']),
  'mcp/artifacts': artifacts('mcp/artifacts', './mcp', [
    'createArtifactsRegistryDefinition', 'createArtifactsToolExecutor',
    'ARTIFACTS_PROVIDER_ID', 'ARTIFACTS_TOOL_NAMES',
  ]),
  comments: { id: 'comments', owner: 'comments', packageName: '@sentropic/cluster-mesh', subpath: './comments', range: '>=0.21.0 <0.24.0',
    requiredMembers: ['createCommentsModule', 'createCommentsPostgresStorage'], namespace: '/comments', meshCoherence: false,
    authPeers: [{ packageName: '@sentropic/comments', subpath: '.', range: COMMENTS_RANGE, requiredMembers: ['createAnnotationRevision', 'validateCapacityDescriptor', 'hashRecord'] }] },
};

const GATED_OWNERS: Readonly<Record<ClusterMeshGatedModuleId, { owner: string; namespace?: ClusterMeshNamespace }>> = {
  'mcp/auth': { owner: 'mcp-auth', namespace: '/mcp' },
  'mcp/auth/hono': { owner: 'mcp-auth', namespace: '/mcp' },
  'mcp/platform': { owner: 'mcp-platform', namespace: '/mcp' },
  'mcp/platform/hono': { owner: 'mcp-platform', namespace: '/mcp' },
  'mcp/platform/experimental': { owner: 'mcp-platform' },
  'mcp/platform/testing': { owner: 'mcp-platform' },
  'mcp/track': { owner: 'track', namespace: '/mcp' },
  'auth-hono': { owner: 'auth-hono', namespace: '/auth' },
  'chat-server': { owner: 'chat-server', namespace: '/chat' },
  flow: { owner: 'flow', namespace: '/workflows' },
  'connector-host': { owner: 'connector-host', namespace: '/connectors' },
  harness: { owner: 'harness' },
  memory: { owner: 'memory', namespace: '/memory' },
  'track-http': { owner: 'track', namespace: '/track' },
  'mcp-broker': { owner: 'mcp-broker' },
  'mcp-connectors': { owner: 'mcp-connector-*' },
};

export function isProviderModuleId(id: string): id is ClusterMeshProviderModuleId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG, id);
}

export function isGatedModuleId(id: string): id is ClusterMeshGatedModuleId {
  return (CLUSTER_MESH_GATED_MODULE_IDS as readonly string[]).includes(id);
}

const entryOf = (packageName: string, subpath: string): string =>
  subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;

export const MODULE_CATALOG_INFO: readonly ClusterMeshModuleInfo[] = Object.freeze([
  ...Object.values(PROVIDER_CATALOG).map((entry): ClusterMeshModuleInfo => Object.freeze({
    id: entry.id,
    owner: entry.owner,
    status: 'delivered' as const,
    entry: entryOf(entry.packageName, entry.subpath),
    requiredRange: entry.range,
    ...(entry.authPeers.length > 0 ? {
      peers: entry.authPeers.map((peer) => ({
        packageName: peer.packageName, entry: entryOf(peer.packageName, peer.subpath), requiredRange: peer.range,
      })),
    } : {}),
    ...(entry.namespace ? { namespace: entry.namespace } : {}),
  })),
  ...CLUSTER_MESH_GATED_MODULE_IDS.map((id): ClusterMeshModuleInfo => Object.freeze({
    id, status: 'source_unavailable' as const, ...GATED_OWNERS[id],
  })),
]);
