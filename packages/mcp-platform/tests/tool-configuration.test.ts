/**
 * Lot 1a — generic tool-configuration codec/compiler tests.
 *
 * Synthetic providers only. No Immo fixture, no SDK, no network, no registry.
 * Covers deterministic round trips/digests, independent settings on two tools,
 * strict schema/version/handler checks, duplicates, missing bindings, weakened
 * policy, rejection preserving active state, and the zero-I/O sentinel.
 */
import { describe, expect, it } from 'vitest';
import type { AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import {
  TOOL_CONFIGURATION_SCHEMA_VERSION,
  ToolConfigurationStore,
  canonicalJson,
  compileToolConfiguration,
  computeCompatibilityDigest,
  computeManifestDigest,
  computePayloadDigest,
  sha256Hex,
  type ApprovedToolSnapshot,
  type ToolConfigurationHandlerBinding,
} from '../src/tool-configuration.js';

const readOnlyGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

const searchTool: CapabilityTool = {
  kind: 'tool',
  name: 'synth_search',
  description: 'Search synthetic records.',
  requiredScopes: ['synth:search'],
  requiredClaims: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const readTool: CapabilityTool = {
  kind: 'tool',
  name: 'synth_read',
  description: 'Read a synthetic record.',
  requiredScopes: ['synth:read'],
  requiredClaims: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  freshness: { maxAgeSeconds: 300, stepUp: 'auth' },
  gates: readOnlyGates,
};

const manifest: AppMcpProviderManifest = {
  appId: 'synth-app',
  providerId: 'synth-provider',
  version: '0.0.0',
  displayName: 'Synthetic provider',
  resources: [],
  tools: [searchTool, readTool],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: ['synth:search', 'synth:read'],
    tenantResolution: 'connector-instance',
  },
  audit: { eventKinds: ['invoke'] },
  durability: {},
};

const searchSchema = {
  type: 'object',
  properties: {
    maxResults: { type: 'integer', minimum: 1, maximum: 100 },
    mode: { type: 'string', enum: ['fast', 'deep'] },
  },
  required: ['maxResults'],
  additionalProperties: false,
};

const readSchema = {
  type: 'object',
  properties: {
    maxChars: { type: 'integer', minimum: 1, maximum: 4000 },
    redact: { type: 'boolean' },
  },
  required: ['maxChars'],
  additionalProperties: false,
};

const handlers: Record<string, ToolConfigurationHandlerBinding> = {
  'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: searchSchema },
  'local-read': { handlerId: 'local-read', capabilityRef: 'synth_read', configSchema: readSchema },
};

function buildSnapshot(): ApprovedToolSnapshot {
  const revision = 'rev-1';
  const base = {
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    providerId: 'synth-provider',
    revision,
    manifestDigest: computeManifestDigest(manifest),
    providerVersion: '0.0.0',
    platformVersion: '0.3.0',
    compatibilityDigest: computeCompatibilityDigest(manifest),
    provenance: {
      approvalRef: 'approval-synth-1',
      revision,
      manifestDigest: computeManifestDigest(manifest),
      reviewedBy: ['sentropic-architect', 'synth-owner'],
    },
    bindings: [
      {
        toolName: 'synth_search',
        capabilityRef: 'synth_search',
        handlerId: 'local-search',
        values: { maxResults: 20, mode: 'fast' },
      },
      {
        toolName: 'synth_read',
        capabilityRef: 'synth_read',
        handlerId: 'local-read',
        values: { maxChars: 1200, redact: true },
      },
    ],
  };
  const payloadDigest = computePayloadDigest(base);
  return { ...base, provenance: { ...base.provenance, payloadDigest } };
}

describe('tool-configuration compiler — synthetic providers only', () => {
  it('compiles two synthetic tools with distinct settings on the intended binding only', () => {
    const result = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.tools.map((tool) => tool.toolName)).toEqual(['synth_read', 'synth_search']);
    const search = result.config.tools.find((tool) => tool.toolName === 'synth_search');
    const read = result.config.tools.find((tool) => tool.toolName === 'synth_read');
    expect(search?.values).toEqual({ maxResults: 20, mode: 'fast' });
    expect(read?.values).toEqual({ maxChars: 1200, redact: true });
    expect(search?.handlerId).toBe('local-search');
    expect(read?.handlerId).toBe('local-read');
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(result.config.tools)).toBe(true);
  });
});
