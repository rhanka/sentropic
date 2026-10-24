// Static provider leaf: topology guard first, then the builtin factory.
import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';
import type { McpRegistryBuiltin } from '../../mcp/registry.js';
import { loadArtifactsMcp } from '../../loaders/mcp/artifacts.js';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import {
  createArtifactsRegistryDefinition,
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
  /** Artifacts is not admitted to the common storage rule (spec r2 section 1.2). */
  commonRuleAdmission?: false;
}): McpRegistryBuiltin {
  if (options.commonRuleAdmission !== undefined && options.commonRuleAdmission !== false) {
    throw new Error('artifacts common-rule admission is not qualified');
  }
  const definition = createArtifactsRegistryDefinition(options.definition);
  const digest = computeManifestDigest(definition.manifest);
  return {
    providerId: ARTIFACTS_PROVIDER_ID,
    version: ARTIFACTS_PROVIDER_VERSION,
    capabilities: definition.manifest.tools.map((tool) => tool.name),
    parameterSchema: ARTIFACTS_PARAMETER_SCHEMA,
    load: async () => {
      const mcp = await loadArtifactsMcp(options.modules);
      const loaded = mcp.createArtifactsRegistryDefinition(options.definition);
      if (computeManifestDigest(loaded.manifest) !== digest) {
        throw new Error('artifacts definition changed after catalog construction');
      }
      return loaded;
    },
  };
}
