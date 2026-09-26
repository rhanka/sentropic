// Side-effect entry imported first by every gateway leaf, loader and compose module: the topology
// guard plus the accepted llm-gateway and llm-mesh ranges, before any provider module evaluates.
import { assertClusterMeshTopology } from './topology.js';

assertClusterMeshTopology('gateway');
