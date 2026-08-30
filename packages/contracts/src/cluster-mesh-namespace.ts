import type { VerifiedInvocationContextPort } from './verified-invocation-context.js';

export const CLUSTER_MESH_NAMESPACES = [
  '/mcp',
  '/gw',
  '/focus',
  '/llm-mesh',
  '/track',
  '/memory',
  '/session',
  '/oauth',
  '/auth',
  '/workflows',
  '/agents',
  '/cli',
  '/chat',
  '/streams',
  '/comments',
  '/locks',
  '/business',
  '/analytics',
  '/workspaces',
  '/config',
  '/documents',
  '/transfers',
  '/connectors',
  '/clients',
  '/admin',
  '/health',
  '/apps',
  '/catalog',
  '/resources',
] as const;

export type ClusterMeshNamespace = (typeof CLUSTER_MESH_NAMESPACES)[number];

export interface ClusterMeshRouterFactoryInput<
  TContextPort = VerifiedInvocationContextPort,
  TReceiptPort = unknown,
> {
  readonly context: TContextPort;
  readonly receipts: TReceiptPort;
}

export interface ClusterMeshNamespaceModule<
  TRouter = unknown,
  TContextPort = VerifiedInvocationContextPort,
  TReceiptPort = unknown,
> {
  readonly namespace: ClusterMeshNamespace;
  readonly enabled: boolean;
  createRouter(input: ClusterMeshRouterFactoryInput<TContextPort, TReceiptPort>): TRouter;
}
