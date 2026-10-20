import '../../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../../modules/contracts.js';

/** Acquire the optional Hono OAuth adapter through selected-leaf preflight. */
export async function loadMcpAuthHono(modules: ClusterMeshModules): Promise<typeof import('@sentropic/mcp-auth/hono')> {
  return (await modules.load('mcp/auth/hono')) as typeof import('@sentropic/mcp-auth/hono');
}
