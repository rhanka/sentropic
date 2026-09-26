// Side-effect entry imported first by every llm-mesh leaf, loader and compose module: the topology
// guard plus the accepted llm-mesh range, before any provider module evaluates.
import { assertClusterMeshTopology } from './topology.js';

assertClusterMeshTopology('llm-mesh');
