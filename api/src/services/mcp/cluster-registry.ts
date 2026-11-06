import { createClusterMeshModules, type ClusterMeshModules } from '@sentropic/cluster-mesh';
import { createArtifactsBuiltin, type ArtifactsDefinitionOptions } from '@sentropic/cluster-mesh/mcp/artifacts';
import { createMcpRegistry, computeManifestDigest, type CompileRegistryInput,
  type CompileRegistryResult, type RegistryDefinition } from '@sentropic/cluster-mesh/mcp/registry';
import { createArtifactsManifest } from '@sentropic/artifacts/mcp-core';
import { MCP_SCOPES } from '@sentropic/mcp-auth';

// W0-close.d #702, published-tuple-2026-10-26.json profile.compiledDigest.
const APP_P1_PROFILE_DIGEST = '9d21623107192b42e683d4712c69093ed19f1498e406d199c4fe3153394cba11';
// Qualified artifacts 0.2.17 APP-P1 manifest; byte-stable tool definitions, compatible root projection, four-tool host selection.
export const APP_P1_MANIFEST_DIGEST = '0725ef3044cf06b04eaae5f407cc364e8c3c8ef570b6835b9aa0038fb556f34b';

export interface AppMcpRegistryOptions extends CompileRegistryInput {
  /** W1.b's profile and application; invocation binding is trusted host code. */
  artifacts: ArtifactsDefinitionOptions;
  /** Existing local providers retain their manifests and approved compatibility receipts. */
  registrations?: readonly RegistryDefinition[];
  selection: string[];
  configurations: Record<string, Record<string, unknown>>;
  /** Defaults to the installed mesh registry; also supports isolated host qualification. */
  modules?: ClusterMeshModules;
}

/**
 * Compile once at startup, before mounting routes. Refusal returns no partial plan.
 * W4 consumes registry.tools / resolveTool directly, preserving exact public names.
 * Compilation neither establishes request authority nor invokes the W1 application.
 */
export async function compileAppMcpRegistry(options: AppMcpRegistryOptions): Promise<CompileRegistryResult> {
  if (!Array.isArray(options.selection)) throw new Error('App registry requires an explicit selection');
  const supplied = options.artifacts;
  if (supplied.profile?.profileDigest !== APP_P1_PROFILE_DIGEST) {
    throw new Error('App artifacts registry requires the frozen APP-P1 profile');
  }
  if (supplied.invocationScope !== undefined && supplied.invocationScope !== MCP_SCOPES.TOOLS_INVOKE) {
    throw new Error('App artifacts invocation scope must match the product MCP scope');
  }
  if (supplied.app.profileDigest !== supplied.profile.profileDigest ||
    JSON.stringify(supplied.app.selectedCapabilities) !== JSON.stringify(supplied.profile.selectedCapabilities)) {
    throw new Error('artifacts app/profile mismatch');
  }
  const definition = { ...supplied, invocationScope: MCP_SCOPES.TOOLS_INVOKE };
  if (computeManifestDigest(createArtifactsManifest(definition)) !== APP_P1_MANIFEST_DIGEST) {
    throw new Error('App artifacts registry requires the pinned APP-P1 manifest');
  }
  const modules = options.modules ?? createClusterMeshModules();
  const builtin = createArtifactsBuiltin({ modules, definition });
  const registry = createMcpRegistry({ modules, builtins: [builtin] });
  for (const registration of options.registrations ?? []) registry.register(registration);
  registry.select(options.selection);
  for (const [id, values] of Object.entries(options.configurations)) registry.configure(id, values);
  return registry.compile({
    bindings: options.bindings,
    compatibility: options.compatibility,
  });
}
