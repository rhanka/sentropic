import { createClusterMeshModules, type ClusterMeshModules } from '@sentropic/cluster-mesh';
import { createArtifactsBuiltin, type ArtifactsDefinitionOptions } from '@sentropic/cluster-mesh/mcp/artifacts';
import { createMcpRegistry, computeManifestDigest, type CompileRegistryInput,
  type CompileRegistryResult, type RegistryDefinition } from '@sentropic/cluster-mesh/mcp/registry';
import { compileArtifactsProfile, createArtifactsManifest, RADAR_ARTIFACTS_PROFILE,
  ARTIFACTS_PROVIDER_ID } from '@sentropic/artifacts/mcp-core';
import { MCP_SCOPES } from '@sentropic/mcp-auth';

const appProfile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);

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
  if (supplied.profile?.profileDigest !== appProfile.profileDigest) {
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
  const modules = options.modules ?? createClusterMeshModules();
  const builtin = createArtifactsBuiltin({ modules, definition });
  const registry = createMcpRegistry({ modules, builtins: [builtin] });
  for (const registration of options.registrations ?? []) registry.register(registration);
  registry.select(options.selection);
  for (const [id, values] of Object.entries(options.configurations)) registry.configure(id, values);
  return registry.compile({
    bindings: options.bindings,
    compatibility: {
      ...options.compatibility,
      // The app owns this fixed specialization. Explicit receipts still go through
      // kernel verification; local provider receipts are never synthesized.
      [ARTIFACTS_PROVIDER_ID]: options.compatibility[ARTIFACTS_PROVIDER_ID] ?? {
        manifestDigest: computeManifestDigest(createArtifactsManifest(definition)),
      },
    },
  });
}
