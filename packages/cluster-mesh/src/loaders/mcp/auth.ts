import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/** Acquire human MCP OAuth only when selected, preserving the provider namespace. */
export async function loadMcpAuth(modules: ClusterMeshModules): Promise<typeof import('@sentropic/mcp-auth')> {
  return (await modules.load('mcp/auth')) as typeof import('@sentropic/mcp-auth');
}
