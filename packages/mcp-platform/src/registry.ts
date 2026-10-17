/**
 * Lot 1b-core — portable MCP provider-registry kernel.
 *
 * Provider-neutral registration, selection, parameterization and
 * all-or-nothing compilation. Pure and synchronous: zero I/O, no mesh,
 * no transport, no network. The compiled immutable plan is consumed later
 * by shared dispatch (3-policy/4a) and the mesh facade (4b-leaves).
 *
 * Per-tool snapshots are compiled with the Lot 1a compiler
 * (`compileToolConfiguration`); this kernel adds no second policy engine.
 * Diagnostics reuse the 1a diagnostic shape.
 */

import type { AppMcpProviderManifest } from './manifest.js';
import type { AppConnectorProviderAdapter } from './runtime.js';
import {
  TOOL_CONFIGURATION_PLATFORM_VERSION,
  TOOL_CONFIGURATION_SCHEMA_VERSION,
  compileToolConfiguration,
  computeCompatibilityDigest,
  computeHandlersDigest,
  computeManifestDigest,
  computePayloadDigest,
  type ApprovedToolBinding,
  type ApprovedToolSnapshot,
  type CompiledToolEntry,
  type ToolConfigurationDiagnostic,
  type ToolConfigurationHandlerBinding,
  type ToolConfigurationProvenance,
  type ToolPolicyOverlay,
} from './tool-configuration.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Closed typed spec for one provider parameter. */
export type ProviderParameterSpec = {
  type: 'string' | 'integer' | 'number' | 'boolean';
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  enum?: Array<string | number | boolean>;
  description?: string;
};

/** Typed parameter schema for one provider (non-secret values only). */
export type ProviderParameterSchema = {
  properties: Record<string, ProviderParameterSpec>;
  required?: string[];
};

/** Per-tool values entry inside a local definition. */
export type LocalToolValues = {
  handlerId: string;
  values: Record<string, unknown>;
  policy?: ToolPolicyOverlay;
};

/** Local provider definition: manifest, adapter, schemas, bindings, policy. */
export type LocalProviderDefinition = {
  manifest: AppMcpProviderManifest;
  adapter: AppConnectorProviderAdapter;
  parameterSchema: ProviderParameterSchema;
  handlers: Record<string, ToolConfigurationHandlerBinding>;
  requiredPorts: string[];
  provenance: ToolConfigurationProvenance;
  toolValues: Record<string, LocalToolValues>;
};

/** Loaded definition: everything is already in memory (Immo's existing shape). */
export type LoadedDefinition = LocalProviderDefinition;

/** Heavy per-tool payload a lazy loader returns after preflight. */
export type LazyToolPayload = {
  adapter: AppConnectorProviderAdapter;
  handlers:
    | Record<string, ToolConfigurationHandlerBinding>
    | Map<string, ToolConfigurationHandlerBinding>;
  toolValues: Record<string, LocalToolValues>;
};

/**
 * Lazy provider definition (RC-M2a): metadata only plus a loader for the
 * heavy payload. The loader is never called on register, catalog or
 * unselected entries — only for selected entries after preflight, with
 * atomic refusal when it throws.
 */
export type LazyDefinition = {
  kind: 'lazy';
  manifest: AppMcpProviderManifest;
  parameterSchema: ProviderParameterSchema;
  requiredPorts: string[];
  provenance: ToolConfigurationProvenance;
  load: () => LazyToolPayload;
};

/** A registrable definition: loaded or lazy. */
export type RegistryDefinition = LoadedDefinition | LazyDefinition;

/** True for lazy definitions (discriminated by `kind`, never by loading). */
export function isLazyDefinition(definition: RegistryDefinition): definition is LazyDefinition {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    (definition as { kind?: unknown }).kind === 'lazy'
  );
}

/** Runtime bindings supplied at compile time (ports to implementations). */
export type RegistryBindings = Record<string, unknown>;

/** Compatibility receipt expected per provider (digest of the SDK capture). */
export type CompatibilityReceipt = {
  manifestDigest: string;
};

export type CompileRegistryInput = {
  bindings: RegistryBindings;
  compatibility: Record<string, CompatibilityReceipt>;
};

export type CompileRegistryResult =
  | { ok: true; registry: CompiledMcpRegistry }
  | { ok: false; diagnostics: ToolConfigurationDiagnostic[] };

/** Catalog descriptor: metadata only, no provider execution. */
export type ProviderCatalogEntry = {
  providerId: string;
  version: string;
  capabilities: string[];
  parameterSchema: ProviderParameterSchema;
  availability: 'available' | 'not-selected' | 'not-configured' | 'invalid';
  diagnostics: ToolConfigurationDiagnostic[];
};

// ---------------------------------------------------------------------------
// Compiled plan
// ---------------------------------------------------------------------------

/** One compiled provider inside the immutable plan. */
export type CompiledProvider = {
  providerId: string;
  version: string;
  manifestDigest: string;
  values: Record<string, unknown>;
  tools: CompiledToolEntry[];
};

/** Pure plan-resolution hit for one exact public tool name. */
export type CompiledToolResolution = {
  providerId: string;
  capabilityName: string;
  values: Record<string, unknown>;
  requiredScopes: string[];
  requiredClaims: string[];
  entry: CompiledToolEntry;
};

/** Immutable compiled registry: exact-name lookup consumed by dispatch. */
export type CompiledMcpRegistry = {
  readonly providers: ReadonlyMap<string, CompiledProvider>;
  readonly tools: ReadonlyMap<string, CompiledToolResolution>;
  resolveTool(publicName: string): CompiledToolResolution | undefined;
};

/** Registry builder: registration, selection, parameterization, compilation. */
export type ProviderRegistry = {
  register(definition: RegistryDefinition): void;
  select(providerIds: string[]): void;
  configure(providerId: string, values: Record<string, unknown>): void;
  compile(input: CompileRegistryInput): CompileRegistryResult;
  catalog(): ProviderCatalogEntry[];
  active(): CompiledMcpRegistry | undefined;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VERSION_PATTERN = /^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diag(
  diagnostics: ToolConfigurationDiagnostic[],
  code: string,
  path: string,
  message: string,
): void {
  diagnostics.push({ code: code as ToolConfigurationDiagnostic['code'], path, message });
}

function checkParameterValue(
  diagnostics: ToolConfigurationDiagnostic[],
  basePath: string,
  key: string,
  spec: ProviderParameterSpec,
  value: unknown,
): boolean {
  const path = `${basePath}.${key}`;
  if (spec.type === 'string') {
    if (typeof value !== 'string') {
      diag(diagnostics, 'invalid_parameter', path, 'expected a string value');
      return false;
    }
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      diag(diagnostics, 'invalid_parameter', path, 'string value is too short');
      return false;
    }
    if (spec.maxLength !== undefined && value.length > spec.maxLength) {
      diag(diagnostics, 'invalid_parameter', path, 'string value is too long');
      return false;
    }
  } else if (spec.type === 'integer') {
    if (!Number.isInteger(value)) {
      diag(diagnostics, 'invalid_parameter', path, 'expected an integer value');
      return false;
    }
    if (spec.minimum !== undefined && (value as number) < spec.minimum) {
      diag(diagnostics, 'invalid_parameter', path, 'integer value below minimum');
      return false;
    }
    if (spec.maximum !== undefined && (value as number) > spec.maximum) {
      diag(diagnostics, 'invalid_parameter', path, 'integer value above maximum');
      return false;
    }
  } else if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      diag(diagnostics, 'invalid_parameter', path, 'expected a finite number value');
      return false;
    }
    if (spec.minimum !== undefined && value < spec.minimum) {
      diag(diagnostics, 'invalid_parameter', path, 'number value below minimum');
      return false;
    }
    if (spec.maximum !== undefined && value > spec.maximum) {
      diag(diagnostics, 'invalid_parameter', path, 'number value above maximum');
      return false;
    }
  } else if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      diag(diagnostics, 'invalid_parameter', path, 'expected a boolean value');
      return false;
    }
  } else {
    diag(diagnostics, 'invalid_parameter', path, 'unknown parameter type in schema');
    return false;
  }
  if (spec.enum !== undefined && !(spec.enum as unknown[]).includes(value as never)) {
    diag(diagnostics, 'invalid_parameter', path, 'value is not an allowed enum member');
    return false;
  }
  return true;
}

function validateParameterValues(
  schema: ProviderParameterSchema,
  values: Record<string, unknown>,
  basePath: string,
): ToolConfigurationDiagnostic[] {
  const diagnostics: ToolConfigurationDiagnostic[] = [];
  for (const key of Object.keys(values)) {
    const spec = schema.properties[key];
    if (spec === undefined) {
      diag(diagnostics, 'unknown_parameter', `${basePath}.${key}`, 'unknown provider parameter');
      continue;
    }
    checkParameterValue(diagnostics, basePath, key, spec, values[key]);
  }
  for (const required of schema.required ?? []) {
    if (values[required] === undefined) {
      diag(diagnostics, 'invalid_parameter', `${basePath}.${required}`, 'missing required parameter');
    }
  }
  return diagnostics;
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    Object.freeze(value);
    return;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
}

function refuseUnsupportedDefinitionKind(detail: string): never {
  const error = new Error(
    `register refuses remote-bound definition: unsupported_definition_kind (${detail})`,
  ) as Error & { code?: string };
  error.code = 'unsupported_definition_kind';
  throw error;
}

function checkDefinitionShape(definition: RegistryDefinition): void {
  // Contract-v8 §3.1 R1 boundary: a remote-bound definition kind is refused
  // before any other validation or mutation, even when the input also
  // carries local-looking fields or a lazy loader payload. Remote-bound
  // providers register only post-merge (R2); this registry stays local-only.
  if (
    isRecord(definition) &&
    (definition as unknown as Record<string, unknown>).kind === 'remote-bound'
  ) {
    refuseUnsupportedDefinitionKind('definition kind');
  }
  // Contract-v8 §3.1 M6.3: an adapter record claiming the remote kind is
  // refused the same way, even on a local-kind definition. Checked before
  // any other validation or mutation, with zero state change.
  if (
    isRecord(definition) &&
    isRecord((definition as unknown as Record<string, unknown>).adapter) &&
    ((definition as unknown as Record<string, unknown>).adapter as Record<string, unknown>).kind ===
      'remote-bound'
  ) {
    refuseUnsupportedDefinitionKind('adapter kind');
  }
  if (!isRecord(definition) || !isRecord(definition.manifest)) {
    throw new Error('register requires a definition with a manifest object');
  }
  const manifest = definition.manifest;
  if (typeof manifest.providerId !== 'string' || manifest.providerId.length === 0) {
    throw new Error('register requires a non-empty manifest providerId');
  }
  if (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) {
    throw new Error(`register requires a semver manifest version (got ${String(manifest.version)})`);
  }
  if (!isRecord(definition.parameterSchema) || !isRecord(definition.parameterSchema.properties)) {
    throw new Error('register requires a parameter schema with properties');
  }
  if (!Array.isArray(definition.requiredPorts)) {
    throw new Error('register requires a requiredPorts array');
  }
  if (!isRecord(definition.provenance)) {
    throw new Error('register requires provenance');
  }
  if (isLazyDefinition(definition)) {
    // Lazy: metadata only. The loader is validated as a function but never
    // called here — no load on register, catalog or unselected entries.
    if (typeof definition.load !== 'function') {
      throw new Error('register requires a lazy loader function');
    }
    return;
  }
  if (definition.adapter === null || definition.adapter === undefined) {
    throw new Error('register requires a compiled local adapter');
  }
  if (!isRecord(definition.handlers)) {
    throw new Error('register requires a handler table');
  }
  if (!isRecord(definition.toolValues)) {
    throw new Error('register requires per-tool values');
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Create an empty provider-registry builder (no modules, no I/O). */
export function createProviderRegistry(): ProviderRegistry {
  const definitions = new Map<string, RegistryDefinition>();
  const configurations = new Map<string, Record<string, unknown>>();
  let selection: string[] = [];
  let current: CompiledMcpRegistry | undefined;

  function compileOne(
    providerId: string,
    input: CompileRegistryInput,
  ): { provider: CompiledProvider; entries: CompiledToolEntry[] } | { diagnostics: ToolConfigurationDiagnostic[] } {
    const prefix = `providers["${providerId}"]`;
    const definition = definitions.get(providerId);
    if (definition === undefined) {
      return { diagnostics: [{ code: 'unknown_provider' as never, path: prefix, message: 'provider is not registered' }] };
    }
    const manifest = definition.manifest;
    const manifestDigest = computeManifestDigest(manifest);
    const receipt = input.compatibility[providerId];
    if (receipt === undefined) {
      return { diagnostics: [{ code: 'missing_compatibility' as never, path: prefix, message: 'missing compatibility receipt' }] };
    }
    if (receipt.manifestDigest !== manifestDigest) {
      return { diagnostics: [{ code: 'compatibility_mismatch' as never, path: prefix, message: 'compatibility receipt does not match the manifest' }] };
    }
    for (const port of definition.requiredPorts) {
      if ((input.bindings as Record<string, unknown>)[port] === undefined) {
        return { diagnostics: [{ code: 'missing_binding' as never, path: `${prefix}.bindings.${port}`, message: 'missing required port binding' }] };
      }
    }
    // Lazy definitions load their heavy payload only here: after preflight,
    // only for a selected entry. A throwing loader is an atomic refusal —
    // nothing is published, `current` is untouched.
    let toolValues: Record<string, LocalToolValues>;
    let handlers: Record<string, ToolConfigurationHandlerBinding> | Map<string, ToolConfigurationHandlerBinding>;
    if (isLazyDefinition(definition)) {
      let payload: LazyToolPayload;
      try {
        payload = definition.load();
      } catch (error) {
        return { diagnostics: [{ code: 'load_failure' as never, path: prefix, message: `lazy loader failed: ${error instanceof Error ? error.message : String(error)}` }] };
      }
      if (!isRecord(payload) || !isRecord(payload.toolValues)) {
        return { diagnostics: [{ code: 'load_failure' as never, path: prefix, message: 'lazy loader returned a malformed payload' }] };
      }
      // Contract-v8 §3.1 M6.3: a lazy payload tunneling a remote-claiming
      // adapter is refused before anything is published (`current`
      // untouched). The `as never` follows the file convention; m5 declares
      // the code in the diagnostic union.
      if (isRecord(payload.adapter as unknown) && (payload.adapter as unknown as Record<string, unknown>).kind === 'remote-bound') {
        return { diagnostics: [{ code: 'unsupported_definition_kind' as never, path: prefix, message: 'lazy loader returned a remote-claiming adapter' }] };
      }
      toolValues = payload.toolValues as Record<string, LocalToolValues>;
      handlers = payload.handlers;
    } else {
      toolValues = definition.toolValues;
      handlers = definition.handlers;
    }
    const handlerTable: Record<string, ToolConfigurationHandlerBinding> =
      handlers instanceof Map ? Object.fromEntries(handlers) : handlers;
    const bindings: ApprovedToolBinding[] = [];
    for (const tool of manifest.tools) {
      const local = toolValues[tool.name];
      if (local === undefined || handlerTable[local.handlerId] === undefined) {
        return { diagnostics: [{ code: 'missing_handler' as never, path: `${prefix}.tools.${tool.name}`, message: 'tool has no handler binding' }] };
      }
      const binding: ApprovedToolBinding = {
        toolName: tool.name,
        capabilityRef: tool.name,
        handlerId: local.handlerId,
        values: deepCloneJson(local.values),
      };
      if (local.policy !== undefined) binding.policy = deepCloneJson(local.policy);
      bindings.push(binding);
    }
    const handlersDigest = computeHandlersDigest(handlers);
    const compatibilityDigest = computeCompatibilityDigest(manifest);
    const snapshot: ApprovedToolSnapshot = {
      schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
      providerId,
      revision: definition.provenance.revision,
      manifestDigest,
      providerVersion: manifest.version,
      platformVersion: TOOL_CONFIGURATION_PLATFORM_VERSION,
      compatibilityDigest,
      handlersDigest,
      provenance: deepCloneJson(definition.provenance),
      bindings,
    };
    snapshot.provenance.manifestDigest = manifestDigest;
    snapshot.provenance.payloadDigest = computePayloadDigest(snapshot);
    const compiled = compileToolConfiguration({
      snapshot,
      manifest,
      handlers,
      compatibilityDigest,
    });
    if (!compiled.ok) {
      return {
        diagnostics: compiled.diagnostics.map((d) => ({
          ...d,
          path: `${prefix}.${d.path}`,
        })),
      };
    }
    const values = deepCloneJson(configurations.get(providerId) ?? {});
    deepFreeze(values);
    const entries = compiled.config.tools.map((entry) => {
      const frozen: CompiledToolEntry = deepCloneJson(entry);
      deepFreeze(frozen);
      return frozen;
    });
    const provider: CompiledProvider = {
      providerId,
      version: manifest.version,
      manifestDigest,
      values,
      tools: entries,
    };
    deepFreeze(provider);
    return { provider, entries };
  }

  return {
    register(definition: RegistryDefinition): void {
      checkDefinitionShape(definition);
      const providerId = definition.manifest.providerId;
      if (definitions.has(providerId)) {
        throw new Error(`duplicate provider registration: ${providerId}`);
      }
      // Freeze validated metadata: clone the manifest and freeze it so later
      // caller mutation cannot alter the registered definition. The lazy
      // loader itself is stored by reference but never called here.
      const manifest = deepCloneJson(definition.manifest) as AppMcpProviderManifest;
      deepFreeze(manifest);
      definitions.set(providerId, { ...definition, manifest });
    },
    select(providerIds: string[]): void {
      const seen = new Set<string>();
      for (const id of providerIds) {
        if (!definitions.has(id)) {
          throw new Error(`unknown provider selection: ${id}`);
        }
        if (seen.has(id)) {
          throw new Error(`duplicate provider selection: ${id}`);
        }
        seen.add(id);
      }
      selection = [...providerIds];
    },
    configure(providerId: string, values: Record<string, unknown>): void {
      const definition = definitions.get(providerId);
      if (definition === undefined) {
        throw new Error(`unknown provider configuration: ${providerId}`);
      }
      if (!selection.includes(providerId)) {
        throw new Error(`unselected provider configuration: ${providerId}`);
      }
      if (!isRecord(values)) {
        throw new Error('configure requires a values object');
      }
      const failures = validateParameterValues(
        definition.parameterSchema,
        values,
        `configure["${providerId}"]`,
      );
      if (failures.length > 0) {
        throw new Error(
          `invalid parameter ${failures[0]!.path}: ${failures[0]!.message} (${failures[0]!.code})`,
        );
      }
      configurations.set(providerId, deepCloneJson(values));
    },
    compile(input: CompileRegistryInput): CompileRegistryResult {
      if (!isRecord(input) || !isRecord(input.bindings) || !isRecord(input.compatibility)) {
        return {
          ok: false,
          diagnostics: [
            { code: 'malformed_snapshot' as never, path: 'config', message: 'compile requires bindings and compatibility objects' },
          ],
        };
      }
      const providers = new Map<string, CompiledProvider>();
      const tools = new Map<string, CompiledToolResolution>();
      const resourceUris = new Set<string>();
      const promptNames = new Set<string>();
      for (const providerId of selection) {
        const result = compileOne(providerId, input);
        if ('diagnostics' in result) {
          return { ok: false, diagnostics: result.diagnostics };
        }
        const definition = definitions.get(providerId);
        if (definition === undefined) {
          return {
            ok: false,
            diagnostics: [
              { code: 'unknown_provider' as never, path: `providers["${providerId}"]`, message: 'provider is not registered' },
            ],
          };
        }
        for (const resource of definition.manifest.resources) {
          if (resourceUris.has(resource.uriTemplate)) {
            return {
              ok: false,
              diagnostics: [
                { code: 'duplicate_resource' as never, path: `providers["${providerId}"].resources.${resource.name}`, message: 'duplicate resource URI across providers' },
              ],
            };
          }
          resourceUris.add(resource.uriTemplate);
        }
        for (const prompt of definition.manifest.prompts) {
          if (promptNames.has(prompt.name)) {
            return {
              ok: false,
              diagnostics: [
                { code: 'duplicate_prompt' as never, path: `providers["${providerId}"].prompts.${prompt.name}`, message: 'duplicate prompt name across providers' },
              ],
            };
          }
          promptNames.add(prompt.name);
        }
        for (const entry of result.entries) {
          if (tools.has(entry.toolName)) {
            return {
              ok: false,
              diagnostics: [
                { code: 'duplicate_tool' as never, path: `providers["${providerId}"].tools.${entry.toolName}`, message: 'duplicate tool name across providers' },
              ],
            };
          }
          tools.set(entry.toolName, {
            providerId,
            capabilityName: entry.toolName,
            values: entry.values,
            requiredScopes: [...entry.requiredScopes],
            requiredClaims: [...entry.requiredClaims],
            entry,
          });
        }
        providers.set(providerId, result.provider);
      }
      const registry: CompiledMcpRegistry = {
        providers,
        tools,
        resolveTool(publicName: string): CompiledToolResolution | undefined {
          return tools.get(publicName);
        },
      };
      Object.freeze(registry);
      current = registry;
      return { ok: true, registry };
    },
    catalog(): ProviderCatalogEntry[] {
      return [...definitions.values()].map((definition) => {
        const providerId = definition.manifest.providerId;
        const capabilities = definition.manifest.tools.map((tool) => tool.name);
        if (!selection.includes(providerId)) {
          return {
            providerId,
            version: definition.manifest.version,
            capabilities,
            parameterSchema: definition.parameterSchema,
            availability: 'not-selected',
            diagnostics: [],
          };
        }
        if (!configurations.has(providerId)) {
          return {
            providerId,
            version: definition.manifest.version,
            capabilities,
            parameterSchema: definition.parameterSchema,
            availability: 'not-configured',
            diagnostics: [],
          };
        }
        return {
          providerId,
          version: definition.manifest.version,
          capabilities,
          parameterSchema: definition.parameterSchema,
          availability: current?.providers.has(providerId) ? 'available' : 'invalid',
          diagnostics: [],
        };
      });
    },
    active(): CompiledMcpRegistry | undefined {
      return current;
    },
  };
}
