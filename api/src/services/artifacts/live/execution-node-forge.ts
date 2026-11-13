import type { ExecutionNodeInputs } from './execution-node-backend';
import { statelessNodeSources } from './execution-node-queue';
import { ExecutionNodeRefusal } from './execution-node-transport';
import type { LiveKey } from './records';
import type { LivePorts } from './ports';

/** D3-A selects the sealed source provider, never the Kubernetes codeload staging path.
 * Concurrent observeHead calls share one read per tenant, generation and binding only.
 */
export function executionNodeForge(inputs: ExecutionNodeInputs | undefined, generation: (key: LiveKey) => Promise<number>): LivePorts['forge'] {
  const provider = () => { if (!inputs) throw new ExecutionNodeRefusal('node_base_hydration_unconfigured'); return inputs; };
  const observe = statelessNodeSources<string>(async encoded => {
    const [, binding] = JSON.parse(encoded) as [string, string];
    const { key } = JSON.parse(binding) as { key: LiveKey };
    return provider().forge.head(key);
  });
  return {
    async head(key) {
      const tenant = provider().tenant(key);
      if (!['sentropic', 'immo'].includes(tenant)) throw new ExecutionNodeRefusal('invalid_node_session');
      return observe(tenant, JSON.stringify({ key, generation: await generation(key) }));
    },
    snapshot: (key, head) => provider().forge.snapshot(key, head),
    reachable: (key, head) => provider().forge.reachable(key, head),
    fastForward: (key, before, after) => provider().forge.fastForward(key, before, after),
  };
}
