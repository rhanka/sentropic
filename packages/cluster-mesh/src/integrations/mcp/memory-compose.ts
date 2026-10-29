import '../../modules/topology-guard-mcp.js';
import type * as MemoryMcp from '@sentropic/engram/mcp-memory';
import type * as MemorySubstrate from '@sentropic/engram/memory-substrate';
import type { ProviderParameterSchema, RegistryDefinition } from '@sentropic/mcp-platform/registry';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { MEMORY_TOOL_NAMES } from '@sentropic/mcp-platform/memory';
import { createMemoryNeutralHandle } from '../../engram-memory/neutral-handle.js';
import { verifyHostBinding } from '../../engram-memory/binding.js';
import type { EngramMemoryDefinitionOptions, EngramMemoryRuntime } from './memory-definition.js';

/** The producer owns all memory semantics; this module supplies the PostgreSQL handle. */
export async function composeEngramMemoryDefinition(
  mcp: typeof MemoryMcp,
  substrate: typeof MemorySubstrate,
  host: EngramMemoryDefinitionOptions,
  parameterSchema: ProviderParameterSchema,
): Promise<{ definition: RegistryDefinition; runtime: EngramMemoryRuntime }> {
  if (host.activation?.hostEnabled !== true || host.activation.tenantEnabled !== true || host.activation.persisted !== true) {
    throw new Error('memory MCP requires persisted host and tenant activation');
  }
  if (JSON.stringify(mcp.MEMORY_TOOL_NAMES) !== JSON.stringify(MEMORY_TOOL_NAMES)) {
    throw new Error('incompatible memory MCP tool inventory');
  }
  if ('allow_unfenced_memory_store' in host.dependencies || 'on_unfenced_memory_store_permitted' in host.dependencies) {
    throw new Error('memory MCP requires a fenced PostgreSQL store');
  }
  if (host.provider.readHost.clock !== host.dependencies.clock || host.provider.writeHost.clock !== host.dependencies.clock) {
    throw new Error('memory MCP requires one shared host clock');
  }
  const { scopeBinding, storage } = host;
  const resolved = scopeBinding.resolveScope(host.scopeRef);
  if (!resolved || resolved.tenantId !== scopeBinding.scope.tenantId || resolved.workspaceId !== scopeBinding.scope.workspaceId) {
    throw new Error('memory MCP scope reference differs from the host binding');
  }
  await verifyHostBinding(storage.kernel, storage.binding, scopeBinding.scope, scopeBinding.store_id);
  const neutral = createMemoryNeutralHandle({ ...storage, scope: scopeBinding.scope });
  let store: MemorySubstrate.CanonicalMemoryStorePort | undefined;
  const close = async () => {
    try { if (store) await store.close(); }
    finally { await storage.kernel.ownership?.release(); }
  };
  try {
    const opened = await substrate.openModuleStorageCanonicalMemoryStoreV1({
      handle: neutral.handle, grant: storage.binding.memoryGrant, scope_binding: scopeBinding,
      clock: host.dependencies.clock, deadline_at: host.deadlineAt,
    });
    if (!opened.ok) throw new Error(`memory canonical store refused: ${opened.error.code}`);
    store = opened.value;
    const fence = neutral.getFence();
    if (!fence) throw new Error('memory canonical store has no acquired fence');
    const dependencies = { ...host.dependencies, canonical_store: store };
    const binding = { scope_ref: host.scopeRef, store_id: scopeBinding.store_id };
    const adapter = mcp.createEngramMemoryProviderV1({ ...host.provider,
      readFacets: mcp.createMemoryReadFacetsV1(dependencies, binding),
      writeFacets: { ...binding, engine: mcp.createMemoryPortV2(dependencies) },
      hostBindings: { ...host.hostBindings, profileBindings: mcp.MEMORY_FROZEN_PROFILE_BINDINGS_V1,
        engine: { mutationPortVersion: 2, recallPortVersion: 3, readPortVersion: 1,
          engineId: host.engineId, canonicalStoreId: scopeBinding.store_id, fenceProvenanceId: fence.fenceId } },
    });
    const server = await mcp.createEngramMemoryMcpServerV1(adapter);
    const handlers: Record<string, { handlerId: string; capabilityRef: string; configSchema: unknown }> = {};
    const toolValues: Record<string, { handlerId: string; values: Record<string, unknown> }> = {};
    for (const tool of adapter.manifest.tools) {
      const handlerId = `${tool.name}-handler`;
      handlers[handlerId] = { handlerId, capabilityRef: tool.name,
        configSchema: { type: 'object', properties: {}, additionalProperties: false } };
      toolValues[tool.name] = { handlerId, values: {} };
    }
    return { runtime: { server, adapter, close }, definition: {
      manifest: adapter.manifest, adapter, parameterSchema, handlers, toolValues, requiredPorts: [],
      provenance: { ...host.provenance, manifestDigest: computeManifestDigest(adapter.manifest) },
    } };
  } catch (error) {
    await close();
    throw error;
  }
}
