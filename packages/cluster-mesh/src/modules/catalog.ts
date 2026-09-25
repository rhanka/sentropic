import type { ClusterMeshNamespace } from '@sentropic/contracts';
import {
  CLUSTER_MESH_GATED_MODULE_IDS,
  type ClusterMeshGatedModuleId,
  type ClusterMeshModuleInfo,
  type ClusterMeshProviderModuleId,
} from './contracts.js';

export const LLM_MESH_PACKAGE = '@sentropic/llm-mesh';
export const LLM_GATEWAY_PACKAGE = '@sentropic/llm-gateway';
export const LLM_MESH_RANGE = '>=0.21.2 <0.22.0';
export const LLM_GATEWAY_RANGE = '>=0.18.0 <0.19.0';
export const MCP_AUTH_RANGE = '>=0.2.1 <0.3.0';
export const JOSE_RANGE = '^5.10.0';
/** Follows llm-gateway 0.18.0's published optional peer range. */
export const AUTH_HONO_RANGE = '^0.15.0';

export interface PeerRequirement {
  readonly packageName: string;
  readonly subpath: string;
  readonly range: string;
  readonly requiredMembers: readonly string[];
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
  /** Literal dynamic import, anchored at the installed cluster-mesh package. */
  readonly importEntry: () => Promise<unknown>;
}

const SERVICE_AUTH_PEERS: readonly PeerRequirement[] = [
  { packageName: '@sentropic/mcp-auth', subpath: './hono', range: MCP_AUTH_RANGE, requiredMembers: ['createRequireServiceAuth'] },
  { packageName: 'jose', subpath: '.', range: JOSE_RANGE, requiredMembers: ['jwtVerify'] },
];
const SESSION_AUTH_PEERS: readonly PeerRequirement[] = [
  { packageName: '@sentropic/auth-hono', subpath: './middleware', range: AUTH_HONO_RANGE, requiredMembers: ['createRequireAuth'] },
];

const mesh = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[],
  importEntry: () => Promise<unknown>, namespace?: ClusterMeshNamespace): ProviderDescriptor => ({
  id, owner: 'llm-mesh', packageName: LLM_MESH_PACKAGE, subpath, range: LLM_MESH_RANGE, requiredMembers,
  meshCoherence: false, authPeers: [], importEntry, ...(namespace ? { namespace } : {}),
});
const gateway = (id: ClusterMeshProviderModuleId, subpath: string, requiredMembers: readonly string[],
  authPeers: readonly PeerRequirement[], importEntry: () => Promise<unknown>,
  namespace?: ClusterMeshNamespace): ProviderDescriptor => ({
  id, owner: 'llm-gateway', packageName: LLM_GATEWAY_PACKAGE, subpath, range: LLM_GATEWAY_RANGE, requiredMembers,
  meshCoherence: true, authPeers, importEntry, ...(namespace ? { namespace } : {}),
});

export const PROVIDER_CATALOG: Readonly<Record<ClusterMeshProviderModuleId, ProviderDescriptor>> = {
  'llm-mesh': mesh('llm-mesh', '.', ['createLlmMesh', 'createProviderRegistry'],
    () => import('@sentropic/llm-mesh'), '/llm-mesh'),
  'llm-mesh/facade': mesh('llm-mesh/facade', './facade', ['createLlmMeshFacade'],
    () => import('@sentropic/llm-mesh/facade')),
  'llm-mesh/enrollment': mesh('llm-mesh/enrollment', './enrollment', [],
    () => import('@sentropic/llm-mesh/enrollment')),
  'llm-mesh/node': mesh('llm-mesh/node', './node', ['InMemoryKeyring'],
    () => import('@sentropic/llm-mesh/node')),
  'llm-mesh/transport/cloud-code': mesh('llm-mesh/transport/cloud-code', './transport/cloud-code',
    ['CloudCodeProviderAdapter'], () => import('@sentropic/llm-mesh/transport/cloud-code')),
  gateway: gateway('gateway', '.', ['createGatewayRouter'], [],
    () => import('@sentropic/llm-gateway'), '/gw'),
  'gateway/auth': gateway('gateway/auth', './auth', ['ServiceAuthVerifyToken'], SERVICE_AUTH_PEERS,
    () => import('@sentropic/llm-gateway/auth')),
  'gateway/auth-hono': gateway('gateway/auth-hono', './auth-hono', ['AuthHonoVerifyToken'], SESSION_AUTH_PEERS,
    () => import('@sentropic/llm-gateway/auth-hono')),
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
  focus: { owner: 'focus', namespace: '/focus' },
  flow: { owner: 'flow', namespace: '/workflows' },
  comments: { owner: 'comments', namespace: '/comments' },
  'connector-host': { owner: 'connector-host', namespace: '/connectors' },
  cli: { owner: 'cli', namespace: '/cli' },
  'build-cli': { owner: 'build-cli' },
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
