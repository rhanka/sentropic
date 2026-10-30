// Static catalog metadata; optional peer code is acquired only by the qualified loader.
import '../../modules/topology-guard-mcp.js';
import { MEMORY_PROVIDER_ID, MEMORY_TOOL_NAMES } from '@sentropic/mcp-platform/memory';
import type { ClusterMeshModules } from '../../modules/contracts.js';
import type { McpRegistryBuiltin, RegistryDefinition } from '../../mcp/registry.js';
import { loadEngramMemoryMcp, loadEngramMemorySubstrate } from '../../loaders/mcp/memory.js';
import { composeEngramMemoryDefinition } from './memory-compose.js';
import type { EngramMemoryDefinitionOptions, EngramMemoryRuntime } from './memory-definition.js';
export type { EngramMemoryDefinitionOptions, EngramMemoryRuntime } from './memory-definition.js';
export { registerEngramMemoryTools, type EngramMemoryTransportDefinition } from './memory-transport.js';
export { createEngramMemoryWireManifest } from './memory-manifest.js';

export interface EngramMemoryBuiltin extends McpRegistryBuiltin {
  /** Available after selected materialization. The host closes it before closing its pool. */
  runtime(): EngramMemoryRuntime | undefined;
}

export function createEngramMemoryBuiltin(options: {
  modules: ClusterMeshModules;
  definition: EngramMemoryDefinitionOptions;
}): EngramMemoryBuiltin {
  let runtime: EngramMemoryRuntime | undefined;
  let loading: Promise<RegistryDefinition> | undefined;
  const parameterSchema = {
    properties: {
      mode: { type: 'string' as const, enum: ['embedded-local'] },
      hostBindingRef: { type: 'string' as const, minLength: 1, maxLength: 128,
        enum: [options.definition.hostBindings?.hostBindingRef] as string[] },
    }, required: ['mode', 'hostBindingRef'],
  };
  return {
    providerId: MEMORY_PROVIDER_ID, version: '1.0.0', capabilities: [...MEMORY_TOOL_NAMES],
    parameterSchema,
    runtime: () => runtime,
    load: () => {
      loading ??= (async () => {
        // Both peer entries must qualify before acquiring ownership or opening a store.
        const mcp = await loadEngramMemoryMcp(options.modules);
        const substrate = await loadEngramMemorySubstrate(options.modules);
        // A second bundled engine owns a different private fenced-store registry.
        // Never advertise tools whose engine cannot admit the substrate's store.
        if (mcp.createMemoryPortV2 !== substrate.createMemoryPortV2) {
          throw new Error('engram memory public entries do not share the engine/provenance instance');
        }
        const composed = await composeEngramMemoryDefinition(mcp, substrate, options.definition, parameterSchema);
        runtime = composed.runtime;
        return composed.definition;
      })().catch(error => { loading = undefined; throw error; });
      return loading;
    },
  };
}
