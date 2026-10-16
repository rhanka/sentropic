/**
 * Lot 7 — mesh facade over the one platform kernel
 * (`@sentropic/cluster-mesh/mcp/registry`, spec-v8 §3).
 *
 * Application entry point for registration, selection, parameterization and
 * compilation. The facade owns its synchronous state (definitions, selection,
 * configurations) and delegates to the platform kernel — acquired through
 * the module registry, never an eager import — only at `compile` time.
 * Mesh-supplied builtins are static descriptors plus loaders: unknown
 * providers (e.g. `sentropic.web-pages` before delivery) fail explicitly,
 * never as silent stubs. Selected builtins materialize at compile; loader
 * failures refuse atomically.
 */
import '../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../modules/contracts.js';
import { loadMcpPlatformRegistry } from '../loaders/mcp/registry.js';
import type {
  CompiledMcpRegistry,
  CompileRegistryInput,
  CompileRegistryResult,
  ProviderCatalogEntry,
  ProviderParameterSchema,
  RegistryDefinition,
  ToolConfigurationDiagnostic,
} from '@sentropic/mcp-platform/registry';

/** Static mesh-supplied builtin: metadata descriptor plus a loader (no dynamic code). */
export interface McpRegistryBuiltin {
  readonly providerId: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly parameterSchema: ProviderParameterSchema;
  load(): Promise<RegistryDefinition>;
}

export interface McpRegistryInput {
  readonly modules: ClusterMeshModules;
  readonly builtins?: readonly McpRegistryBuiltin[];
}

export interface McpRegistryFacade {
  register(definition: RegistryDefinition): void;
  select(providerIds: string[]): void;
  configure(providerId: string, values: Record<string, unknown>): void;
  catalog(): ProviderCatalogEntry[];
  compile(input: CompileRegistryInput): Promise<CompileRegistryResult>;
  compiled(): CompiledMcpRegistry | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): CompileRegistryResult {
  const diagnostics: ToolConfigurationDiagnostic[] = [
    { code: 'facade_refusal' as never, path, message },
  ];
  return { ok: false, diagnostics };
}

export function createMcpRegistry(options: McpRegistryInput): McpRegistryFacade {
  const registryModules = options.modules;
  const builtins = new Map<string, McpRegistryBuiltin>();
  for (const builtin of options.builtins ?? []) {
    if (builtins.has(builtin.providerId)) {
      throw new Error(`duplicate builtin provider: ${builtin.providerId}`);
    }
    builtins.set(builtin.providerId, builtin);
  }
  const local = new Map<string, RegistryDefinition>();
  let selection: string[] = [];
  const configurations = new Map<string, Record<string, unknown>>();
  let current: CompiledMcpRegistry | undefined;

  const knownIds = (): Set<string> => new Set([...builtins.keys(), ...local.keys()]);

  const mutate = (): void => {
    current = undefined;
  };

  return {
    register(definition: RegistryDefinition): void {
      const providerId = isRecord(definition) && isRecord(definition.manifest)
        ? (definition.manifest as Record<string, unknown>)['providerId']
        : undefined;
      if (typeof providerId !== 'string' || providerId.length === 0) {
        throw new Error('register requires a definition with a non-empty manifest providerId');
      }
      if (knownIds().has(providerId)) {
        throw new Error(`duplicate provider registration: ${providerId}`);
      }
      local.set(providerId, definition);
      mutate();
    },
    select(providerIds: string[]): void {
      const known = knownIds();
      const seen = new Set<string>();
      for (const id of providerIds) {
        if (!known.has(id)) throw new Error(`unknown provider selection: ${id}`);
        if (seen.has(id)) throw new Error(`duplicate provider selection: ${id}`);
        seen.add(id);
      }
      selection = [...providerIds];
      mutate();
    },
    configure(providerId: string, values: Record<string, unknown>): void {
      if (!local.has(providerId) && !builtins.has(providerId)) {
        throw new Error(`unknown provider configuration: ${providerId}`);
      }
      if (!selection.includes(providerId)) {
        throw new Error(`unselected provider configuration: ${providerId}`);
      }
      if (!isRecord(values)) throw new Error('configure requires a values object');
      configurations.set(providerId, values);
      mutate();
    },
    catalog(): ProviderCatalogEntry[] {
      const entries: ProviderCatalogEntry[] = [];
      for (const builtin of builtins.values()) {
        entries.push({
          providerId: builtin.providerId,
          version: builtin.version,
          capabilities: [...builtin.capabilities],
          parameterSchema: builtin.parameterSchema,
          availability: !selection.includes(builtin.providerId)
            ? 'not-selected'
            : configurations.has(builtin.providerId) || Object.keys(builtin.parameterSchema.properties).length === 0
              ? current?.providers.has(builtin.providerId) ? 'available' : 'not-configured'
              : 'not-configured',
          diagnostics: [],
        });
      }
      for (const [providerId, definition] of local) {
        const manifest = (definition as { manifest: { version: string; tools: Array<{ name: string }> } }).manifest;
        entries.push({
          providerId,
          version: manifest.version,
          capabilities: manifest.tools.map((tool) => tool.name),
          parameterSchema: (definition as { parameterSchema: ProviderParameterSchema }).parameterSchema,
          availability: !selection.includes(providerId)
            ? 'not-selected'
            : current?.providers.has(providerId)
              ? 'available'
              : 'not-configured',
          diagnostics: [],
        });
      }
      return entries;
    },
    async compile(request: CompileRegistryInput): Promise<CompileRegistryResult> {
      // The kernel is acquired here — never eagerly — on a fresh instance per
      // compile, so a refusal publishes nothing and keeps `current` intact.
      const kernelModule = await loadMcpPlatformRegistry(registryModules);
      const kernel = kernelModule.createProviderRegistry();
      for (const [providerId, definition] of local) {
        try {
          kernel.register(definition);
        } catch (error) {
          return fail(
            `providers["${providerId}"]`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      for (const providerId of selection) {
        const builtin = builtins.get(providerId);
        if (builtin === undefined || local.has(providerId)) continue;
        let loaded: RegistryDefinition;
        try {
          loaded = await builtin.load();
        } catch (error) {
          return fail(
            `providers["${providerId}"].loader`,
            `builtin loader failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        try {
          kernel.register(loaded);
        } catch (error) {
          return fail(
            `providers["${providerId}"]`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      try {
        kernel.select(selection);
      } catch (error) {
        return fail('selection', error instanceof Error ? error.message : String(error));
      }
      for (const [providerId, values] of configurations) {
        if (!selection.includes(providerId)) continue;
        try {
          kernel.configure(providerId, values);
        } catch (error) {
          return fail(
            `configure["${providerId}"]`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const result = kernel.compile(request);
      if (result.ok) current = result.registry;
      return result;
    },
    compiled(): CompiledMcpRegistry | undefined {
      return current;
    },
  };
}
