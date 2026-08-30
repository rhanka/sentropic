import type {
  ClusterMeshNamespaceModule,
  VerifiedInvocationContextPort,
} from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import { Hono } from 'hono';
import type { ClusterMeshRuntime } from '../runtime/generation.js';
import { createNamespaceRegistry } from '../runtime/namespace-registry.js';

export type ClusterMeshHonoNamespaceModule = ClusterMeshNamespaceModule<
  Hono,
  VerifiedInvocationContextPort,
  InvocationReceiptPort
>;

export interface ClusterMeshPluginOptions {
  readonly runtime: ClusterMeshRuntime;
  readonly namespaces: readonly ClusterMeshHonoNamespaceModule[];
}

export function createClusterMeshPlugin(options: ClusterMeshPluginOptions): Hono {
  const plugin = new Hono();
  const registry = createNamespaceRegistry(options.namespaces);
  for (const module of registry.enabled()) {
    const router = module.createRouter({
      context: options.runtime.context,
      receipts: options.runtime.receiptPort,
    });
    plugin.route(module.namespace, router);
  }
  return plugin;
}
