import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';

/** Qualified optional peer acquisition; missing/incompatible peers never become stubs. */
export async function loadEngramMemoryMcp(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/engram/mcp-memory')> {
  return await modules.load('mcp/memory') as typeof import('@sentropic/engram/mcp-memory');
}

export async function loadEngramMemorySubstrate(
  modules: ClusterMeshModules,
): Promise<typeof import('@sentropic/engram/memory-substrate')> {
  return await modules.load('engram-memory/substrate') as typeof import('@sentropic/engram/memory-substrate');
}
