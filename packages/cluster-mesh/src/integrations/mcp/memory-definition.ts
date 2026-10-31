import '../../modules/topology-guard-mcp.js';
import type { McpMemoryProviderOptions, EngramMemoryMcpServerV1 } from '@sentropic/engram/mcp-memory';
import type { MemoryEngineDependenciesV2, ModuleStorageMemoryStoreOptionsV1 } from '@sentropic/engram/memory-substrate';
import type { CreateMemoryNeutralHandleInput } from '../../engram-memory/neutral-handle.js';
import type { ToolConfigurationProvenance } from '@sentropic/mcp-platform/tool-configuration';

/** Host authorities stay explicit; the builtin owns only the in-process wiring. */
export interface EngramMemoryDefinitionOptions {
  readonly activation: { readonly hostEnabled: true; readonly tenantEnabled: true; readonly persisted: true };
  readonly storage: CreateMemoryNeutralHandleInput;
  readonly scopeBinding: ModuleStorageMemoryStoreOptionsV1['scope_binding'];
  readonly scopeRef: string;
  readonly deadlineAt: string;
  readonly engineId: string;
  readonly dependencies: Omit<MemoryEngineDependenciesV2, 'canonical_store' | 'allow_unfenced_memory_store' | 'on_unfenced_memory_store_permitted'>;
  readonly provider: Omit<McpMemoryProviderOptions, 'readFacets' | 'writeFacets' | 'hostBindings'>;
  readonly hostBindings: Omit<McpMemoryProviderOptions['hostBindings'], 'engine' | 'profileBindings'>;
  readonly provenance: Omit<ToolConfigurationProvenance, 'manifestDigest'>;
}

export interface EngramMemoryRuntime {
  readonly server: EngramMemoryMcpServerV1;
  readonly adapter: ReturnType<typeof import('@sentropic/engram/mcp-memory')['createEngramMemoryProviderV1']>;
  close(): Promise<void>;
}
