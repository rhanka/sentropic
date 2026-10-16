// Side-effect entry imported first by every mcp leaf, loader and compose module: the base
// topology assertion before any provider module evaluates. Platform ranges are enforced at
// load time through the module catalog (tight `MCP_PLATFORM_RANGE`); unlike llm-mesh/gateway
// there is no install-family coherence graph, so no leaf family is asserted here.
import { assertClusterMeshTopology } from './topology.js';

assertClusterMeshTopology();
