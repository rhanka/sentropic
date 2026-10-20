// Static provider leaf: topology guard first, then the builtin factory.
import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';
import type { McpRegistryBuiltin } from '../../mcp/registry.js';
import { loadArtifactsMcp } from '../../loaders/mcp/artifacts.js';
import {
  ARTIFACTS_TOOL_NAMES,
  ARTIFACTS_PARAMETER_SCHEMA,
  ARTIFACTS_PROVIDER_ID,
  ARTIFACTS_PROVIDER_VERSION,
  type ArtifactsDefinitionOptions,
} from '@sentropic/artifacts/mcp';

export type { ArtifactsDefinitionOptions };
export { createArtifactsToolExecutor, type ArtifactsApp } from '@sentropic/artifacts/mcp';

/**
 * The `sentropic.artifacts` builtin descriptor (spec-v8 §3/§9): static
 * metadata for the catalog plus a qualified loader. The heavy definition
 * materializes only at compile time, only when selected, through the
 * module registry — an absent/incompatible artifacts peer refuses the
 * compilation atomically instead of falling back to a stub. All host
 * customization (storage, identity, template and content bindings)
 * arrives through `definition`; nothing Immo-specific lives here.
 */
export function createArtifactsBuiltin(options: {
  modules: ClusterMeshModules;
  definition: ArtifactsDefinitionOptions;
}): McpRegistryBuiltin {
  return {
    providerId: ARTIFACTS_PROVIDER_ID,
    version: ARTIFACTS_PROVIDER_VERSION,
    capabilities: [...ARTIFACTS_TOOL_NAMES],
    parameterSchema: ARTIFACTS_PARAMETER_SCHEMA,
    load: async () => {
      const mcp = await loadArtifactsMcp(options.modules);
      return mcp.createArtifactsRegistryDefinition(options.definition);
    },
  };
}
