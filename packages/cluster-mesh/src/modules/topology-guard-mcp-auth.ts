// Only static OAuth leaves select this floor. Unused loaders and registry remain provider-free.
import { assertClusterMeshTopology, ClusterMeshTopologyError } from './topology.js';
import { findInstalledPackage, physicalDirOf } from './resolution.js';
import { satisfiesRange } from './semver.js';
import { MCP_OAUTH_AUTH_RANGE } from './catalog.js';

assertClusterMeshTopology();
const auth = findInstalledPackage('@sentropic/mcp-auth', physicalDirOf(import.meta.url));
if (!auth) {
  throw new ClusterMeshTopologyError('not_installed', [], 'OAuth requires @sentropic/mcp-auth');
}
if (!satisfiesRange(auth.version, MCP_OAUTH_AUTH_RANGE)) {
  throw new ClusterMeshTopologyError('incompatible_version', [auth.dir],
    `OAuth requires @sentropic/mcp-auth@"${MCP_OAUTH_AUTH_RANGE}"; installed ${String(auth.version)}`);
}
