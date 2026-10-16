/**
 * Lot 1b-core — registry dispatch-handoff tests (pure plan resolution).
 *
 * Resolution only: no adapter invocation, no transport, no I/O. The adapter
 * spies below prove dispatch handoff never executes a handler.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import type { AppConnectorProviderAdapter } from '../src/runtime.js';
import {
  computeManifestDigest,
  type ToolConfigurationProvenance,
} from '../src/tool-configuration.js';
import {
  createProviderRegistry,
  type LocalProviderDefinition,
} from '../src/registry.js';

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
    requiredClaims: ['probe-user'],
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

function makeSpiedAdapter(manifest: AppMcpProviderManifest) {
  return {
    appId: 'probe-app',
    connectorId: 'probe-connector',
    manifest,
    resolveTenant: vi.fn(async (input: { principalSub: string; tenantRef: string; connectorInstanceId: string }) => ({
      principalRef: input.principalSub,
      tenantRef: input.tenantRef,
      connectorInstanceId: input.connectorInstanceId,
    })),
    listCapabilities: vi.fn(async () => []),
    invokeTool: vi.fn(async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const })),
    readResource: vi.fn(async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' as const })),
    validateSecrets: vi.fn(async () => []),
  } satisfies AppConnectorProviderAdapter;
}

function makeDefinition(providerId: string, adapter: AppConnectorProviderAdapter): LocalProviderDefinition {
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
    adapter,
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
    toolValues: {
      probe_search: { handlerId: 'probe_search-handler', values: { limit: 20 } },
    },
  };
}

describe('registry dispatch handoff', () => {
  it('resolves the plan without invoking any adapter method', async () => {
    const registry = createProviderRegistry();
    const manifest: AppMcpProviderManifest = {
      appId: 'probe-app',
      providerId: 'alpha',
      version: '0.0.0',
      displayName: 'Probe alpha',
      resources: [],
      tools: [makeTool('probe_search')],
      prompts: [],
      authz: { requiredClaims: [], scopes: ['probe:read'], tenantResolution: 'connector-instance' },
      audit: { eventKinds: ['invoke'] },
      durability: {},
    };
    const adapter = makeSpiedAdapter(manifest);
    const def = makeDefinition('alpha', adapter);
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const compiled = registry.compile({
      bindings: {},
      compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const hit = compiled.registry.resolveTool('probe_search');
    expect(hit?.providerId).toBe('alpha');
    expect(hit?.requiredScopes).toEqual(['probe:read']);
    expect(hit?.requiredClaims).toEqual(['probe-user']);
    expect(hit?.values).toEqual({ limit: 20 });
    expect(adapter.invokeTool).not.toHaveBeenCalled();
    expect(adapter.listCapabilities).not.toHaveBeenCalled();
    expect(adapter.resolveTenant).not.toHaveBeenCalled();
  });

  it('uses exact names: case and prefix variants do not resolve', () => {
    const registry = createProviderRegistry();
    const manifest: AppMcpProviderManifest = {
      appId: 'probe-app',
      providerId: 'alpha',
      version: '0.0.0',
      displayName: 'Probe alpha',
      resources: [],
      tools: [makeTool('probe_search')],
      prompts: [],
      authz: { requiredClaims: [], scopes: ['probe:read'], tenantResolution: 'connector-instance' },
      audit: { eventKinds: ['invoke'] },
      durability: {},
    };
    const def = makeDefinition('alpha', makeSpiedAdapter(manifest));
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const compiled = registry.compile({
      bindings: {},
      compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.registry.resolveTool('Probe_Search')).toBeUndefined();
    expect(compiled.registry.resolveTool('probe_')).toBeUndefined();
    expect(compiled.registry.resolveTool('probe_search ')).toBeUndefined();
    expect(compiled.registry.resolveTool('probe_search')).toBeDefined();
  });

  it('resolution follows the latest compiled plan, never a stale one', () => {
    const registry = createProviderRegistry();
    const manifest: AppMcpProviderManifest = {
      appId: 'probe-app',
      providerId: 'alpha',
      version: '0.0.0',
      displayName: 'Probe alpha',
      resources: [],
      tools: [makeTool('probe_search')],
      prompts: [],
      authz: { requiredClaims: [], scopes: ['probe:read'], tenantResolution: 'connector-instance' },
      audit: { eventKinds: ['invoke'] },
      durability: {},
    };
    const def = makeDefinition('alpha', makeSpiedAdapter(manifest));
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const first = registry.compile({
      bindings: {},
      compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
    });
    expect(first.ok).toBe(true);
    def.toolValues['probe_search']!.policy = { requiredScopes: ['probe:read', 'probe:v2'] };
    const second = registry.compile({
      bindings: {},
      compatibility: { alpha: { manifestDigest: computeManifestDigest(def.manifest) } },
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.registry.resolveTool('probe_search')?.requiredScopes).toEqual(['probe:read']);
    expect(second.registry.resolveTool('probe_search')?.requiredScopes).toEqual([
      'probe:read',
      'probe:v2',
    ]);
  });
});
