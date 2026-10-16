/**
 * Lot 1b-core — registry configuration tests (values, ports, bindings,
 * compatibility receipts and effective compiled policy).
 *
 * Pure kernel only: synthetic providers and ports, no I/O.
 */
import { describe, expect, it } from 'vitest';
import type { AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import {
  computeManifestDigest,
  type ToolConfigurationProvenance,
} from '../src/tool-configuration.js';
import {
  createProviderRegistry,
  type LocalProviderDefinition,
} from '../src/registry.js';
import type { AppConnectorProviderAdapter } from '../src/runtime.js';

const readOnlyGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

function makeTool(name: string): CapabilityTool {
  return {
    kind: 'tool',
    name,
    description: `Synthetic tool ${name}.`,
    requiredScopes: ['probe:read'],
    requiredClaims: [],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    redactionClass: 'low',
    mutability: 'read-only',
    mutatesExternalSystem: false,
    idempotency: { required: false },
    gates: readOnlyGates,
  };
}

const limitSchema = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

const stubAdapter = {
  appId: 'probe-app',
  connectorId: 'probe-connector',
  manifest: undefined as never,
  resolveTenant: async (input: { principalSub: string; tenantRef: string; connectorInstanceId: string }) => ({
    principalRef: input.principalSub,
    tenantRef: input.tenantRef,
    connectorInstanceId: input.connectorInstanceId,
  }),
  listCapabilities: async () => [],
  invokeTool: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const }),
  readResource: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const }),
  validateSecrets: async () => [],
} satisfies Omit<AppConnectorProviderAdapter, 'manifest'> as unknown as AppConnectorProviderAdapter;

function makeDefinition(providerId: string): LocalProviderDefinition {
  const manifest: AppMcpProviderManifest = {
    appId: 'probe-app',
    providerId,
    version: '0.0.0',
    displayName: `Probe ${providerId}`,
    resources: [],
    tools: [makeTool('probe_search')],
    prompts: [],
    authz: { requiredClaims: [], scopes: ['probe:read'], tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
  const provenance: ToolConfigurationProvenance = {
    approvalRef: 'approval-local-1',
    revision: 'rev-1',
    manifestDigest: computeManifestDigest(manifest),
    reviewedBy: ['probe-owner'],
  };
  return {
    manifest,
    adapter: { ...stubAdapter, manifest },
    parameterSchema: {
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'] },
        maxResults: { type: 'integer', minimum: 1, maximum: 50 },
        threshold: { type: 'number', minimum: 0, maximum: 1 },
        verbose: { type: 'boolean' },
      },
      required: ['mode'],
    },
    handlers: {
      'probe_search-handler': {
        handlerId: 'probe_search-handler',
        capabilityRef: 'probe_search',
        configSchema: limitSchema,
      },
    },
    requiredPorts: ['storage', 'clock'],
    provenance,
    toolValues: {
      probe_search: { handlerId: 'probe_search-handler', values: { limit: 20 } },
    },
  };
}

const bindings = { storage: { kind: 'memory' }, clock: { kind: 'fixed' } };

function compatibilityFor(def: LocalProviderDefinition) {
  return { [def.manifest.providerId]: { manifestDigest: computeManifestDigest(def.manifest) } };
}

describe('registry configuration', () => {
  it('rejects mistyped, out-of-bounds and missing-required values', () => {
    const registry = createProviderRegistry();
    registry.register(makeDefinition('alpha'));
    registry.select(['alpha']);
    expect(() => registry.configure('alpha', { mode: 7 as never })).toThrowError(/invalid_parameter/);
    expect(() => registry.configure('alpha', { mode: 'fast', maxResults: 500 })).toThrowError(
      /invalid_parameter/,
    );
    expect(() => registry.configure('alpha', { mode: 'fast', threshold: 2 })).toThrowError(
      /invalid_parameter/,
    );
    expect(() => registry.configure('alpha', { maxResults: 5 })).toThrowError(/invalid_parameter/);
    expect(() => registry.configure('alpha', { mode: 'warp-speed' })).toThrowError(
      /invalid_parameter/,
    );
    registry.configure('alpha', { mode: 'fast', maxResults: 5, threshold: 0.5, verbose: true });
  });

  it('requires every declared port binding before activation', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha');
    registry.register(alpha);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const missing = registry.compile({
      bindings: { storage: { kind: 'memory' } },
      compatibility: compatibilityFor(alpha),
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.diagnostics.some((d) => d.code === 'missing_binding')).toBe(true);
    const full = registry.compile({ bindings, compatibility: compatibilityFor(alpha) });
    expect(full.ok).toBe(true);
  });

  it('requires a matching compatibility receipt per selected provider', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha');
    registry.register(alpha);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const absent = registry.compile({ bindings, compatibility: {} });
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(absent.diagnostics.some((d) => d.code === 'missing_compatibility')).toBe(true);
  });

  it('accepts a strengthening overlay and exposes the effective scopes', () => {
    const registry = createProviderRegistry();
    const def = makeDefinition('alpha');
    def.toolValues['probe_search']!.policy = { requiredScopes: ['probe:read', 'probe:extra'] };
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const compiled = registry.compile({ bindings, compatibility: compatibilityFor(def) });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.registry.resolveTool('probe_search')?.requiredScopes).toEqual([
      'probe:read',
      'probe:extra',
    ]);
  });

  it('refuses a weakening overlay with the 1a diagnostic under the provider path', () => {
    const registry = createProviderRegistry();
    const def = makeDefinition('alpha');
    def.toolValues['probe_search']!.policy = { requiredScopes: [] };
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const compiled = registry.compile({ bindings, compatibility: compatibilityFor(def) });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnostics.some((d) => d.code === 'policy_weakening')).toBe(true);
    expect(compiled.diagnostics.every((d) => d.path.startsWith('providers["alpha"]'))).toBe(true);
  });

  it('rejects a malformed parameter schema at registration', () => {
    const registry = createProviderRegistry();
    const def = makeDefinition('alpha');
    def.parameterSchema = { properties: undefined as never };
    expect(() => registry.register(def)).toThrowError(/parameter schema/i);
  });
});
