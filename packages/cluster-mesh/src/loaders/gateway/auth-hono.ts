import '../../modules/topology-guard.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/**
 * Session-mode startup preflight: acquires the gateway session-auth namespace and preloads @sentropic/auth-hono/middleware resolved from the installed gateway. Await it before binding a listener.
 * Rejects with `ClusterMeshModuleUnavailableError` (recognize by `code`).
 */
export async function loadGatewayAuthHono(modules: ClusterMeshModules): Promise<typeof import('@sentropic/llm-gateway/auth-hono')> {
  return (await modules.load('gateway/auth-hono')) as typeof import('@sentropic/llm-gateway/auth-hono');
}
