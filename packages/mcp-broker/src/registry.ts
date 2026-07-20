/**
 * BR-72 DEPTH Lot 2 — minimal, connector-AGNOSTIC connector registry.
 *
 * Keeps ONE responsibility: mount `AppConnectorProviderAdapter`s by
 * `connectorId` and hand them back on lookup. No connector-specific logic
 * lives here — any adapter (github, gmail, a future write connector, ...)
 * registers the same way. See `./broker.ts` for the dispatch seam that
 * consumes this registry.
 */
import type { AppConnectorProviderAdapter } from '../../mcp-platform/src/runtime.js';

export class DuplicateConnectorError extends Error {
  readonly code = 'duplicate_connector';
  readonly connectorId: string;

  constructor(connectorId: string) {
    super(`ConnectorRegistry: a connector is already registered for connectorId "${connectorId}".`);
    this.name = 'DuplicateConnectorError';
    this.connectorId = connectorId;
  }
}

/**
 * `ConnectorRegistry` — mounts `AppConnectorProviderAdapter`s keyed by
 * `adapter.connectorId`. Duplicate registration for the same `connectorId`
 * is a typed error (fail fast on a mounting mistake, never silently
 * overwrite an already-mounted connector).
 */
export class ConnectorRegistry {
  private readonly adapters = new Map<string, AppConnectorProviderAdapter>();

  register(adapter: AppConnectorProviderAdapter): void {
    if (this.adapters.has(adapter.connectorId)) {
      throw new DuplicateConnectorError(adapter.connectorId);
    }
    this.adapters.set(adapter.connectorId, adapter);
  }

  get(connectorId: string): AppConnectorProviderAdapter | undefined {
    return this.adapters.get(connectorId);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
