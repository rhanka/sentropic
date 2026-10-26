/** Post-train (post-#662) version literals for cluster-mesh tests.
 * Independently authored at the rebased baseline: never derive these from
 * package manifests or production catalog constants. Historical and skew
 * fixtures stay inline in their specs until 1.26b centralizes them. */
export const TRAIN_LLM_MESH_VERSION = '0.29.0';
export const TRAIN_LLM_GATEWAY_VERSION = '0.21.4';
export const TRAIN_CLUSTER_MESH_VERSION = '0.22.5';
/** Supported ranges consumed by registry/topology specs (adopted in 1.26b). */
export const TRAIN_LLM_MESH_RANGE = '>=0.22.0 <0.30.0';
export const TRAIN_LLM_GATEWAY_RANGE = '>=0.19.0 <0.22.0';
/** Pre-train fake defaults preserved by the package-tree helper. */
export const HISTORICAL_FAKE_MESH_VERSION = '0.22.0';
export const HISTORICAL_FAKE_GATEWAY_VERSION = '0.19.0';
