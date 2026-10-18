/**
 * MCP-L5 Lot 1 — internal connector index derived from the compiled plan.
 *
 * INTERNAL module: not part of the broker public entry. Mounts
 * `AppConnectorProviderAdapter`s for the providers present in the immutable
 * compiled registry plan and hands them back on lookup. Duplicate
 * registration for the same connectorId is a typed error (fail fast, never
 * silently overwrite). Consumers cannot register handlers separately from
 * the plan.
 */

import type { AppConnectorProviderAdapter } from '@sentropic/mcp-platform';
import type { CompiledMcpRegistry } from '@sentropic/mcp-platform/registry';

export class DuplicateConnectorError extends Error {
  readonly code = 'duplicate_connector';
  readonly connectorId: string;

  constructor(connectorId: string) {
    super(`ConnectorRegistry: a connector is already registered for connectorId "${connectorId}".`);
    this.name = 'DuplicateConnectorError';
    this.connectorId = connectorId;
  }
}

/** Refusal for an adapter whose provider is absent from the compiled plan. */
export class PlanBindingError extends Error {
  readonly code = 'plan_binding_mismatch';
  readonly connectorId: string;

  constructor(connectorId: string, providerId: string) {
    super(`CompiledConnectorIndex: adapter "${connectorId}" names provider "${providerId}" absent from the compiled plan.`);
    this.name = 'PlanBindingError';
    this.connectorId = connectorId;
  }
}

/**
 * `CompiledConnectorIndex` — plan-bound adapter lookup. Every mounted
 * adapter's manifest providerId must resolve in the compiled plan;
 * adapters for unknown providers are refused at construction.
 */
export class CompiledConnectorIndex {
  private readonly adapters = new Map<string, AppConnectorProviderAdapter>();

  constructor(plan: CompiledMcpRegistry, adapters: AppConnectorProviderAdapter[]) {
    for (const adapter of adapters) {
      if (!plan.providers.has(adapter.manifest.providerId)) {
        throw new PlanBindingError(adapter.connectorId, adapter.manifest.providerId);
      }
      const incumbent = this.adapters.get(adapter.connectorId);
      if (incumbent !== undefined && incumbent !== adapter) {
        throw new DuplicateConnectorError(adapter.connectorId);
      }
      this.adapters.set(adapter.connectorId, adapter);
    }
  }

  get(connectorId: string): AppConnectorProviderAdapter | undefined {
    return this.adapters.get(connectorId);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
