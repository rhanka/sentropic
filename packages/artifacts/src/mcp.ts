/** Platform registry wrapper. Use /mcp-core when the platform is absent. */
export * from './mcp-core.js';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { RegistryDefinition } from '@sentropic/mcp-platform/registry';
import {
  createArtifactsAdapter, ARTIFACTS_TOOL_SPECS, ARTIFACTS_PARAMETER_SCHEMA,
  type ArtifactsAdapterOptions,
} from './mcp-core.js';
type Schema = Record<string, unknown>;
export interface ArtifactsDefinitionOptions extends ArtifactsAdapterOptions {
  /** Local config-review reference (integrity metadata, never authority). */
  approvalRef?: string;
  revision?: string;
  reviewedBy?: string[];
}

const EMPTY_TOOL_CONFIG: Schema = { type: 'object', properties: {}, additionalProperties: false };

/** Build the kernel registry definition for sentropic.artifacts (§3). */
export function createArtifactsRegistryDefinition(
  options: ArtifactsDefinitionOptions,
): RegistryDefinition {
  const adapter = createArtifactsAdapter(options);
  const manifest = adapter.manifest;
  const handlers: Record<string, { handlerId: string; capabilityRef: string; configSchema: unknown }> = {};
  const toolValues: Record<string, { handlerId: string; values: Record<string, unknown> }> = {};
  for (const spec of ARTIFACTS_TOOL_SPECS) {
    const handlerId = `${spec.name}-handler`;
    handlers[handlerId] = { handlerId, capabilityRef: spec.name, configSchema: EMPTY_TOOL_CONFIG };
    toolValues[spec.name] = { handlerId, values: {} };
  }
  return {
    manifest,
    adapter,
    parameterSchema: ARTIFACTS_PARAMETER_SCHEMA,
    handlers,
    requiredPorts: [],
    provenance: {
      approvalRef: options.approvalRef ?? 'artifacts-local-1',
      revision: options.revision ?? 'rev-1',
      manifestDigest: computeManifestDigest(manifest),
      reviewedBy: options.reviewedBy ?? ['host-owner'],
    },
    toolValues,
  };
}
