/**
 * Resource plane (BR-70 / ARCH-21a — foundations slice).
 *
 * Assembles the dispatcher with the foundations providers. The catalog provider is
 * wired here; the MCP resource provider is added in Lot 2. The chat-coupled surfaces
 * (resource_invoke bridge, /proc/jobs, /context/session) and the chat-ui tree +
 * LLM tool-family are DEFERRED and coordinated with the chat lane.
 */

import { compositeCatalogRegistry } from '../skills/catalog.js';
import { ResourceDispatcher } from './dispatcher.js';
import { CatalogResourceProvider } from './providers/catalog-provider.js';

export * from './ref.js';
export * from './contract.js';
export * from './authz.js';
export { ResourceProviderBase } from './provider-base.js';
export { ResourceDispatcher } from './dispatcher.js';
export { CatalogResourceProvider } from './providers/catalog-provider.js';

let dispatcher: ResourceDispatcher | undefined;

/** The process-wide resource plane dispatcher (catalog provider wired; MCP in Lot 2). */
export function getResourceDispatcher(): ResourceDispatcher {
  if (!dispatcher) {
    dispatcher = new ResourceDispatcher().registerProvider(
      new CatalogResourceProvider(compositeCatalogRegistry)
    );
  }
  return dispatcher;
}

/** Test seam: reset the assembled dispatcher singleton. */
export function resetResourceDispatcherForTesting(): void {
  dispatcher = undefined;
}
