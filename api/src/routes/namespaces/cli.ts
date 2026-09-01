import {
  CLI_PATHS as CLUSTER_MESH_CLI_PATHS,
  createCliNamespaceModule,
} from '@sentropic/cluster-mesh';

import { requireAuth } from '../../middleware/auth';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';

const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh session control is not configured');

export const CLI_PATHS = CLUSTER_MESH_CLI_PATHS;
export const CLI_ENABLED = control.ptyEvidence === 'adapter_available';

// BR75-SG1 keeps this module unmounted. Package adapters only parse intents;
// they cannot activate process, PTY, or session authority on their own.
export const productCliModule = createCliNamespaceModule({
  enabled: CLI_ENABLED,
  generationId: control.runtime.generation.generationId,
  authenticate: requireAuth,
});
