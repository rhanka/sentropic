/**
 * Internal remote-bound seam (contract-v6 R1 boundary, RC-6 Lot 4).
 *
 * A `remote-bound` definition names tools served by another stack behind a
 * versioned injected client port. This module is pure and INTERNAL: it is not
 * part of the public RegistryDefinition, `register` refuses remote-bound-shaped
 * input with unsupported_definition_kind, and no transport imports this module.
 * It never touches the network, fetch, the filesystem or the clock. Unknown
 * tools, unselected providers, schema mismatches and missing or mis-versioned
 * ports are all rejected BEFORE the client port is touched, so invalid
 * candidates acquire zero resources. Shared transport guards and routing
 * belong to post-merge R2; no h2a import.
 */
import { canonicalizeRegistryRequest } from './registry-entry.js';
import {
  validateBoundedValue,
  type JSONValue,
} from './registry-parameters.js';

/** Versioned injected remote-client port (v1). Provided via bindings, never imported. */
export interface RemoteClientPortV1 {
  readonly version: 'v1';
  forward(canonicalText: string): Promise<unknown>;
}

/** Public definition for a remotely served provider (extends the kernel's local definition). */
export interface RemoteBoundDefinition {
  readonly kind: 'remote-bound';
  readonly providerId: string;
  readonly version: string;
  readonly toolNames: readonly string[];
  /** Versioned port name resolved from the bindings map (e.g. `registry.remoteClient/v1`). */
  readonly clientPort: string;
}

function isRemoteClientPortV1(value: unknown): value is RemoteClientPortV1 {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['version'] === 'v1' && typeof record['forward'] === 'function';
}

/**
 * Resolve one remote call: exact-name match, selection check, bounded-schema
 * validation, then a single `forward` of the canonical request text through
 * the injected port. Rejects before forwarding on every invalid candidate.
 */
export async function resolveRemoteCall(
  definitions: readonly RemoteBoundDefinition[],
  selectedProviderIds: readonly string[],
  bindings: Readonly<Record<string, unknown>>,
  schema: unknown,
  input: {
    readonly tool: string;
    readonly args: Readonly<Record<string, JSONValue>>;
  },
): Promise<unknown> {
  const definition = definitions.find((candidate) => candidate.toolNames.includes(input.tool));
  if (definition === undefined) {
    throw new Error(`Unknown tool '${input.tool}': no remote-bound definition`);
  }
  if (!selectedProviderIds.includes(definition.providerId)) {
    throw new Error(
      `Provider '${definition.providerId}' is not selected: cannot serve tool '${input.tool}'`,
    );
  }
  const diagnostics = validateBoundedValue(schema, input.args);
  if (diagnostics.length > 0) {
    throw new Error(
      `Invalid arguments for remote tool '${input.tool}': ${diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('; ')}`,
    );
  }
  const port = bindings[definition.clientPort];
  if (!isRemoteClientPortV1(port)) {
    const reason = port === undefined || port === null
      ? `missing client port '${definition.clientPort}'`
      : 'client port version mismatch (expected v1)';
    throw new Error(`Cannot forward tool '${input.tool}': ${reason}`);
  }
  const canonical = canonicalizeRegistryRequest({ tool: input.tool, args: input.args });
  return port.forward(canonical.canonicalText);
}
