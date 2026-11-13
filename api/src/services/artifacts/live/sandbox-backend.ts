import type { LivePorts } from './ports';
import { ExecutionNodeRefusal, executionNodeConfig } from './execution-node-transport';
import { ExecutionNodeAdapter } from './execution-node-adapter';

/** Runtime boundary shared by live, build-only and cache preparation. Host auth, drafts,
 * source authorization and SG4 publication remain in the existing controller/service.
 */
export type SandboxBackend = Pick<LivePorts, 'pods' | 'worker' | 'cache' | 'heavy' | 'admission'>;
export type SandboxBackendKind = 'kubernetes' | 'execution-node';
export const SANDBOX_BACKEND_ENV = 'ARTIFACT_SANDBOX_BACKEND';
export function sandboxBackendKind(env: Readonly<Record<string, string | undefined>>): SandboxBackendKind {
  const kind = env[SANDBOX_BACKEND_ENV] ?? 'kubernetes';
  if (kind !== 'kubernetes' && kind !== 'execution-node') throw new ExecutionNodeRefusal(`invalid_config:${SANDBOX_BACKEND_ENV}`);
  return kind;
}
/** Explicit factories ensure rollback does not initialize node credentials or contact the node.
 * S1-B1 supplies the sealed-base/session registry composition through the node factory.
 * No silent Kubernetes fallback on node refusal: an operator must change configuration.
 */
export function selectSandboxBackend<T>(env: Readonly<Record<string, string | undefined>>, factories: {
  kubernetes(): T; executionNode(node: ExecutionNodeAdapter): T;
}): T {
  return sandboxBackendKind(env) === 'kubernetes' ? factories.kubernetes()
    : factories.executionNode(new ExecutionNodeAdapter(executionNodeConfig(env)));
}
