// Separately installed runtime: carries cluster-mesh and its selected peers, and is the
// only package in the process that imports cluster-mesh leaves.
import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
import * as meshLeaf from '@sentropic/cluster-mesh/llm-mesh';
import { createGatewayRouter, stubGatewayConfig } from '@sentropic/cluster-mesh/gateway';
import { loadGatewayAuth } from '@sentropic/cluster-mesh/loaders/gateway/auth';

const LEAVES = ['llm-mesh', 'llm-mesh/facade', 'llm-mesh/enrollment', 'llm-mesh/node', 'llm-mesh/transport/cloud-code',
  'gateway', 'gateway/auth', 'gateway/auth-hono'];

export async function describeRuntime() {
  const service = await loadGatewayAuth(createClusterMeshModules());
  const report = verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });
  const router = createGatewayRouter({ config: stubGatewayConfig });
  const leaves = {};
  for (const leaf of LEAVES) {
    leaves[leaf] = await import(`@sentropic/cluster-mesh/${leaf}`).then(() => 'imported', (error) => error.code ?? error.message);
  }
  return {
    instances: report.instances.map((instance) => instance.path),
    llmMesh: report.llmMesh.path,
    gatewayLlmMesh: report.gateway.llmMesh.path,
    leaf: typeof meshLeaf.createLlmMesh,
    service: typeof service.ServiceAuthVerifyToken,
    health: (await router.request('/healthz')).status,
    leaves,
  };
}
