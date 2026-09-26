// Side-effect entry imported first by every leaf, loader and compose module:
// registers this copy (via topology.js) and fails the importing module on an
// invalid per-process topology before any provider module evaluates.
import { assertClusterMeshTopology } from './topology.js';

assertClusterMeshTopology();
