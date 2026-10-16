/**
 * RC-M2(a) — Registry entry abstraction (contract-v3 §4 envelope + §5 injectables).
 *
 * A `RegistryEntry` is the frozen contract between runtime wiring (dispatch,
 * canonical request) and a compiled tool. It is built once via
 * `buildRegistryEntry` and never mutated afterwards: the entry carries the
 * compiled tool identity (`CompiledToolEntry`), the bounded 2020-12 schema
 * runtime arguments are validated against, and the canonical request digest
 * the runner receives.
 */
import {
  canonicalJsonText,
  entryDigestHex,
} from './registry-canonical.js';
import type {
  CompiledToolConfiguration,
  CompiledToolEntry,
} from './tool-configuration.js';
import {
  validateBoundedValue,
  type JSONValue,
} from './registry-parameters.js';

export interface RegistryCanonicalRequest {
  readonly tool: string;
  readonly args: Readonly<Record<string, JSONValue>>;
  readonly tenant?: string;
  readonly canonicalText: string;
  readonly digest: string;
}

/** Canonicalize a runtime call into one frozen request form (RC-M2c runner side). */
export function canonicalizeRegistryRequest(input: {
  readonly tool: string;
  readonly args: Readonly<Record<string, JSONValue>>;
  readonly tenant?: string;
}): RegistryCanonicalRequest {
  const descriptor: Record<string, unknown> = { tool: input.tool, args: input.args };
  if (input.tenant !== undefined) descriptor['tenant'] = input.tenant;
  const request: RegistryCanonicalRequest = {
    tool: input.tool,
    args: Object.freeze({ ...input.args }),
    ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
    canonicalText: canonicalJsonText(descriptor),
    digest: entryDigestHex(descriptor),
  };
  return Object.freeze(request);
}

export interface RegistryEntry {
  readonly toolName: string;
  readonly capabilityRef: string;
  readonly handlerId: string;
  readonly schema: unknown;
  readonly canonical: RegistryCanonicalRequest;
}

/** Build a frozen `RegistryEntry` binding a compiled tool to its canonical request. */
export function buildRegistryEntry(
  compiled: CompiledToolEntry,
  schema: unknown,
  canonical: RegistryCanonicalRequest,
): RegistryEntry {
  if (canonical.tool !== compiled.toolName) {
    throw new Error(
      `Canonical request tool '${canonical.tool}' does not match compiled entry '${compiled.toolName}'`,
    );
  }
  const entry: RegistryEntry = {
    toolName: compiled.toolName,
    capabilityRef: compiled.capabilityRef,
    handlerId: compiled.handlerId,
    schema,
    canonical,
  };
  return Object.freeze(entry);
}

/**
 * Map runtime arguments onto the entry (RC-M2c): the single chokepoint where
 * runtime values enter module code. The whole argument object is validated
 * against the entry's bounded schema; unknown slots are rejected by the
 * schema's `additionalProperties: false`, missing slots by its `required`.
 */
export interface ResolvedRegistryEntry {
  readonly entry: RegistryEntry;
  readonly args: Readonly<Record<string, JSONValue>>;
}

/**
 * RC-M2(b) — resolve a runtime call against a compiled configuration in one
 * call: find the compiled tool by exact name, canonicalize the request, bind
 * the entry and map the arguments. Unknown tools are rejected before any
 * argument is inspected.
 */
export function resolveRegistryEntry(
  config: CompiledToolConfiguration,
  schema: unknown,
  input: {
    readonly tool: string;
    readonly args: Readonly<Record<string, JSONValue>>;
    readonly tenant?: string;
  },
): ResolvedRegistryEntry {
  const compiled = config.tools.find((candidate) => candidate.toolName === input.tool);
  if (compiled === undefined) {
    throw new Error(`Unknown tool '${input.tool}': no compiled entry`);
  }
  const canonical = canonicalizeRegistryRequest(input);
  const entry = buildRegistryEntry(compiled, schema, canonical);
  return { entry, args: mapEntryArguments(entry, input.args) };
}

export function mapEntryArguments(
  entry: RegistryEntry,
  args: Readonly<Record<string, JSONValue>>,
): Readonly<Record<string, JSONValue>> {
  const diagnostics = validateBoundedValue(entry.schema, args);
  if (diagnostics.length > 0) {
    throw new Error(
      `Invalid arguments for tool '${entry.toolName}': ${diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('; ')}`,
    );
  }
  return Object.freeze({ ...args });
}
