// Static provider leaf: topology guard first, then the builtin factory.
import '../../modules/topology-guard-mcp.js';
import type { ClusterMeshModules } from '../../modules/contracts.js';
import type { McpRegistryBuiltin } from '../../mcp/registry.js';
import { loadWebPagesMcp } from '../../loaders/mcp/web-pages.js';
import {
  ARTIFACTS_TOOL_NAMES,
  WEB_PAGES_PARAMETER_SCHEMA,
  WEB_PAGES_PROVIDER_ID,
  WEB_PAGES_PROVIDER_VERSION,
  type WebPagesDefinitionOptions,
} from '@sentropic/artifacts/mcp';

export type { WebPagesDefinitionOptions };

/**
 * The `sentropic.web-pages` builtin descriptor (spec-v8 §3/§9): static
 * metadata for the catalog plus a qualified loader. The heavy definition
 * materializes only at compile time, only when selected, through the
 * module registry — an absent/incompatible artifacts peer refuses the
 * compilation atomically instead of falling back to a stub. All host
 * customization (storage, identity, template and content bindings)
 * arrives through `definition`; nothing Immo-specific lives here.
 */
export function createWebPagesBuiltin(options: {
  modules: ClusterMeshModules;
  definition: WebPagesDefinitionOptions;
}): McpRegistryBuiltin {
  return {
    providerId: WEB_PAGES_PROVIDER_ID,
    version: WEB_PAGES_PROVIDER_VERSION,
    capabilities: [...ARTIFACTS_TOOL_NAMES],
    parameterSchema: WEB_PAGES_PARAMETER_SCHEMA,
    load: async () => {
      const mcp = await loadWebPagesMcp(options.modules);
      return mcp.createWebPagesRegistryDefinition(options.definition);
    },
  };
}
