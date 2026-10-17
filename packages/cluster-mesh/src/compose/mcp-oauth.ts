/** Node-only stateful OAuth composition. Root imports never select this provider graph. */
import '../modules/topology-guard-mcp.js';
import { Hono } from 'hono';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadMcpAuth } from '../loaders/mcp/auth.js';
import { loadMcpAuthHono } from '../loaders/mcp/auth/hono.js';
import { loadMcpPlatformBridge } from '../loaders/mcp/bridge.js';
import { validateOAuthOptions, verifyOAuthRequest } from '../mcp/oauth-context.js';
import { createOAuthSessions } from '../mcp/oauth-sessions.js';
import { createOAuthEgress } from '../mcp/oauth-egress.js';
import { connectOAuthServer } from '../mcp/oauth-runner.js';
import type { McpOAuthNamespace, McpOAuthNamespaceOptions } from '../mcp/oauth-contracts.js';

export type {
  McpOAuthNamespace, McpOAuthNamespaceOptions, McpOAuthPrincipal, McpOAuthCallContext,
  McpOAuthSessionOptions, McpOAuthExchangeOptions, McpOAuthEgressProfile, McpOAuthEgressResponse,
} from '../mcp/oauth-contracts.js';
export { McpOAuthEgressError, type McpOAuthEgressRefusal } from '../mcp/oauth-profiles.js';

/** Preflight configuration and selected provider contracts before the host starts listening. */
export async function createMcpOAuthNamespace(
  modules: ClusterMeshModules,
  input: McpOAuthNamespaceOptions,
): Promise<McpOAuthNamespace> {
  validateOAuthOptions(input);
  const options: McpOAuthNamespaceOptions = {
    ...input, tools: structuredClone(input.tools), sessions: { ...input.sessions },
    authorizationServers: [...input.authorizationServers], scopesSupported: [...input.scopesSupported],
    requiredIngressScopes: [...input.requiredIngressScopes],
    ...(input.exchange ? { exchange: { ...input.exchange } } : {}),
  };
  const [provider, adapter, bridge] = await Promise.all([
    loadMcpAuth(modules), loadMcpAuthHono(modules), loadMcpPlatformBridge(modules),
  ]);
  const auth = provider.createMcpAuth({ resource: options.resource,
    authorizationServers: [...options.authorizationServers], scopesSupported: [...options.scopesSupported],
    keySource: options.keySource,
  });
  const egress = createOAuthEgress(options);
  const sessions = createOAuthSessions(options.sessions, options, () => connectOAuthServer(options, bridge, egress));
  const metadataRoutes = adapter.mcpAuthRoutes(auth);
  const mcpRoutes = new Hono().all('/', async (c) => {
    try {
      const authority = await verifyOAuthRequest(auth, provider.McpAuthError, options, c.req.raw);
      return await sessions.handle(c.req.raw, authority);
    } catch (error) {
      return auth.challenge(error);
    }
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    metadataRoutes, mcpRoutes,
    module: Object.freeze({ namespace: '/mcp' as const, enabled: true, createRouter: () => mcpRoutes }),
    close: () => closing ??= (async () => { egress.close(); await sessions.close(); })(),
  });
}
