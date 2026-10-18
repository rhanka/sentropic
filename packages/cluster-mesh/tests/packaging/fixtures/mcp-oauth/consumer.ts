import type { ClusterMeshModules } from '@sentropic/cluster-mesh';
import type {
  McpOAuthCallContext, McpOAuthNamespaceOptions,
} from '@sentropic/cluster-mesh/compose/mcp-oauth';
import { createMcpAuth, McpAuthError } from '@sentropic/cluster-mesh/mcp/auth';
import { mcpAuthRoutes } from '@sentropic/cluster-mesh/mcp/auth/hono';
import { loadMcpAuth, loadMcpAuthHono } from '@sentropic/cluster-mesh/loaders/mcp';

/** The real twelve-tool host adapter supplies the compiled registry and domain invocation. */
export async function createImmoMcp(modules: ClusterMeshModules, host: McpOAuthNamespaceOptions) {
  const options = {
    registry: host.registry,
    tools: host.tools,
    resource: host.resource,
    authorizationServers: host.authorizationServers,
    keySource: host.keySource,
    scopesSupported: ['immo:read', 'immo:search', 'immo:documents:read'],
    requiredIngressScopes: ['immo:read'],
    subjectClientId: 'immo-mcp',
    environment: host.environment,
    requiredAcr: host.requiredAcr,
    sessions: host.sessions,
    resolveAccount: host.resolveAccount,
    exchange: host.exchange,
    invoke: (tool, args, call) => host.invoke(tool, args, call),
  } satisfies McpOAuthNamespaceOptions;
  const { createMcpOAuthNamespace } = await import('@sentropic/cluster-mesh/compose/mcp-oauth');
  return createMcpOAuthNamespace(modules, options);
}

type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : T;
export const functions: [NotAny<typeof createMcpAuth>, NotAny<typeof McpAuthError>,
  NotAny<typeof mcpAuthRoutes>, NotAny<typeof loadMcpAuth>, NotAny<typeof loadMcpAuthHono>] =
  [createMcpAuth, McpAuthError, mcpAuthRoutes, loadMcpAuth, loadMcpAuthHono];
export const hasNoBearer: 'accessToken' extends keyof McpOAuthCallContext ? never : true = true;
