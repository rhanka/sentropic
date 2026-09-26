import '../../modules/topology-guard-gateway.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Service-mode startup preflight: acquires the gateway service-auth namespace and preloads @sentropic/mcp-auth/hono and jose resolved from the installed gateway. Await it before binding a listener.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadGatewayAuth(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-gateway/auth')> {
  return (await modules.load('gateway/auth')) as typeof import('@sentropic/llm-gateway/auth');
}
