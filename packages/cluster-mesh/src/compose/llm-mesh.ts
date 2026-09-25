import '../modules/topology-guard-llm-mesh.js';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import type { Hono } from 'hono';
import type { ClusterMeshHonoNamespaceModule } from '../hono/plugin.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadLlmMesh } from '../loaders/llm-mesh/index.js';
import { disabledNamespaceModule } from './disabled.js';

export interface LlmMeshRouterInput {
  readonly llmMesh: typeof import('@sentropic/llm-mesh');
  readonly context: VerifiedInvocationContextPort;
  readonly receipts: InvocationReceiptPort;
}

export interface LlmMeshNamespaceOptions {
  readonly enabled: boolean;
  /** Host-injected router factory (llm-mesh exports no router); never imported from application source. */
  readonly createRouter: (input: LlmMeshRouterInput) => Hono;
}

/**
 * Prepare the `/llm-mesh` namespace at composition startup. Disabled preparation
 * resolves nothing; an enabled namespace whose provider is unavailable rejects
 * before any listener binds. Mount the result with `createClusterMeshPlugin`.
 */
export async function createLlmMeshNamespaceModule(
  modules: ClusterMeshModules,
  options: LlmMeshNamespaceOptions,
): Promise<ClusterMeshHonoNamespaceModule> {
  if (!options.enabled) return disabledNamespaceModule('/llm-mesh');
  const llmMesh = await loadLlmMesh(modules);
  return {
    namespace: '/llm-mesh',
    enabled: true,
    createRouter: ({ context, receipts }) => options.createRouter({ llmMesh, context, receipts }),
  };
}
