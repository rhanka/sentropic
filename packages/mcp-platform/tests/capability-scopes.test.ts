/**
 * Lot L-3policy/4a — guarded dispatch policy tests (pure, no transport).
 *
 * Exact-name resolve against the compiled registry, then the principal's
 * scopes/claims against the compiled effective policy. Refusals carry stable
 * codes and never invoke the adapter. Transport envelopes belong to
 * streamable-http/stdio tests.
 */
import { describe, expect, it } from 'vitest';
import type { AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import type { AppConnectorProviderAdapter } from '../src/runtime.js';
import { computeManifestDigest, type ToolConfigurationProvenance } from '../src/tool-configuration.js';
import { createProviderRegistry, type LocalProviderDefinition } from '../src/registry.js';
import { authorizeDispatch, type DispatchPrincipal } from '../src/transport/dispatch.js';

const readOnlyGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

function makeTool(name: string, scopes: string[], claims: string[]): CapabilityTool {
  return {
    kind: 'tool',
    name,
    description: `Synthetic tool ${name}.`,
    requiredScopes: scopes,
    requiredClaims: claims,
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

function makeAdapter(manifest: AppMcpProviderManifest): AppConnectorProviderAdapter {
  return {
    appId: 'probe-app',
    connectorId: 'probe-connector',
    manifest,
    resolveTenant: async (input) => ({
      principalRef: input.principalSub,
      tenantRef: input.tenantRef,
      connectorInstanceId: input.connectorInstanceId,
    }),
    listCapabilities: async () => [],
    invokeTool: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const }),
    readResource: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const }),
    validateSecrets: async () => [],
  };
}

function makeDefinition(providerId: string): LocalProviderDefinition {
  const manifest: AppMcpProviderManifest = {
    appId: 'probe-app',
    providerId,
    version: '0.0.0',
    displayName: `Probe ${providerId}`,
    resources: [],
    tools: [makeTool('probe_search', ['probe:read'], ['probe-user'])],
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
    adapter: makeAdapter(manifest),
    parameterSchema: { properties: { mode: { type: 'string' } } },
    handlers: {
      'probe_search-handler': {
        handlerId: 'probe_search-handler',
        capabilityRef: 'probe_search',
        configSchema: limitSchema,
      },
    },
    requiredPorts: [],
    provenance,
    toolValues: { probe_search: { handlerId: 'probe_search-handler', values: { limit: 20 } } },
  };
}

const principal: DispatchPrincipal = {
  sub: 'user-1',
  clientId: 'client-1',
  scopes: ['probe:read'],
  claims: ['probe-user'],
};

function compiledRegistry() {
  const builder = createProviderRegistry();
  const def = makeDefinition('alpha');
  builder.register(def);
  builder.select(['alpha']);
  builder.configure('alpha', { mode: 'fast' });
  const compiled = builder.compile({
    bindings: {},
    compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
  });
  if (!compiled.ok) throw new Error('fixture compile failed');
  return compiled.registry;
}

describe('guarded dispatch policy', () => {
  it('authorizes an exact-name call when scopes and claims cover the effective policy', () => {
    const decision = authorizeDispatch({
      registry: compiledRegistry(),
      toolName: 'probe_search',
      principal,
    });
    expect(decision).toEqual({ allowed: true, providerId: 'alpha', capabilityName: 'probe_search' });
  });

  it('refuses an unknown tool before any policy evaluation', () => {
    const decision = authorizeDispatch({ registry: compiledRegistry(), toolName: 'nope', principal });
    expect(decision).toEqual({ allowed: false, code: 'unknown_tool' });
  });

  it('refuses a missing scope with a stable code', () => {
    const decision = authorizeDispatch({
      registry: compiledRegistry(),
      toolName: 'probe_search',
      principal: { ...principal, scopes: [] },
    });
    expect(decision).toEqual({ allowed: false, code: 'insufficient_scope' });
  });

  it('refuses a missing claim with a stable code', () => {
    const decision = authorizeDispatch({
      registry: compiledRegistry(),
      toolName: 'probe_search',
      principal: { ...principal, claims: [] },
    });
    expect(decision).toEqual({ allowed: false, code: 'insufficient_claims' });
  });

  it('enforces the strengthened overlay scopes, not the manifest minima', () => {
    const builder = createProviderRegistry();
    const def = makeDefinition('alpha');
    def.toolValues['probe_search']!.policy = { requiredScopes: ['probe:read', 'probe:extra'] };
    builder.register(def);
    builder.select(['alpha']);
    builder.configure('alpha', { mode: 'fast' });
    const compiled = builder.compile({
      bindings: {},
      compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
    });
    if (!compiled.ok) throw new Error('fixture compile failed');
    const without = authorizeDispatch({ registry: compiled.registry, toolName: 'probe_search', principal });
    expect(without).toEqual({ allowed: false, code: 'insufficient_scope' });
    const withExtra = authorizeDispatch({
      registry: compiled.registry,
      toolName: 'probe_search',
      principal: { ...principal, scopes: ['probe:read', 'probe:extra'] },
    });
    expect(withExtra.allowed).toBe(true);
  });
});
