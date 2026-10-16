/**
 * Lot 1b-core — portable provider-registry kernel tests (registration,
 * selection, configuration and all-or-nothing compilation).
 *
 * Pure kernel only: synthetic providers, no mesh, no transport, no I/O.
 * Real HTTP/stdio acceptance belongs to 4a/4b-leaves.
 */
import { describe, expect, it } from 'vitest';
import type {
  AppConnectorProviderAdapter,
  AppMcpProviderManifest,
  CapabilityTool,
} from '../src/manifest.js';
import type { AppMcpProviderManifest as Manifest } from '../src/manifest.js';
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

function makeTool(name: string, scopes: string[]): CapabilityTool {
  return {
    kind: 'tool',
    name,
    description: `Synthetic tool ${name}.`,
    requiredScopes: scopes,
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

function makeManifest(providerId: string, tools: CapabilityTool[]): Manifest {
  return {
    appId: 'probe-app',
    providerId,
    version: '0.0.0',
    displayName: `Probe ${providerId}`,
    resources: [],
    tools,
    prompts: [],
    authz: {
      requiredClaims: [],
      scopes: ['probe:use'],
      tenantResolution: 'connector-instance',
    },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
}

const stubAdapter: AppConnectorProviderAdapter = {
  appId: 'probe-app',
  connectorId: 'probe-connector',
  manifest: makeManifest('probe', []),
  resolveTenant: async (input) => ({
    principalRef: input.principalSub,
    tenantRef: input.tenantRef,
    connectorInstanceId: input.connectorInstanceId,
  }),
  listCapabilities: async () => [],
  invokeTool: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' }),
  readResource: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' }),
  validateSecrets: async () => [],
};

const limitSchema = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

function makeProvenance(manifest: AppMcpProviderManifest): ToolConfigurationProvenance {
  return {
    approvalRef: 'approval-local-1',
    revision: 'rev-1',
    manifestDigest: computeManifestDigest(manifest),
    reviewedBy: ['probe-owner'],
  };
}

function makeDefinition(
  providerId: string,
  toolNames: string[],
  scopes = ['probe:use'],
): LocalProviderDefinition {
  const manifest = makeManifest(providerId, toolNames.map((n) => makeTool(n, scopes)));
  const handlers: LocalProviderDefinition['handlers'] = {};
  const toolValues: LocalProviderDefinition['toolValues'] = {};
  for (const name of toolNames) {
    handlers[`${name}-handler`] = {
      handlerId: `${name}-handler`,
      capabilityRef: name,
      configSchema: limitSchema,
    };
    toolValues[name] = {
      handlerId: `${name}-handler`,
      values: { limit: 20 },
    };
  }
  return {
    manifest,
    adapter: { ...stubAdapter, manifest },
    parameterSchema: {
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'] },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['mode'],
    },
    handlers,
    requiredPorts: ['storage'],
    provenance: makeProvenance(manifest),
    toolValues,
  };
}

const bindings = { storage: { kind: 'memory' } };

function compatibilityFor(def: LocalProviderDefinition) {
  return {
    [def.manifest.providerId]: { manifestDigest: computeManifestDigest(def.manifest) },
  };
}

describe('provider registry kernel', () => {
  it('registers two synthetic providers and lists them in the catalog', () => {
    const registry = createProviderRegistry();
    registry.register(makeDefinition('alpha', ['alpha_search']));
    registry.register(makeDefinition('beta', ['beta_doc']));
    const catalog = registry.catalog();
    expect(catalog.map((c) => c.providerId).sort()).toEqual(['alpha', 'beta']);
    expect(catalog.every((c) => c.version === '0.0.0')).toBe(true);
  });

  it('rejects a duplicate provider registration, including builtin collisions', () => {
    const registry = createProviderRegistry();
    registry.register(makeDefinition('alpha', ['alpha_search']));
    const again = () => registry.register(makeDefinition('alpha', ['alpha_other']));
    expect(again).toThrowError(/duplicate provider/i);
  });

  it('rejects unknown and duplicate selection ids', () => {
    const registry = createProviderRegistry();
    registry.register(makeDefinition('alpha', ['alpha_search']));
    expect(() => registry.select(['alpha', 'nope'])).toThrowError(/unknown provider/i);
    expect(() => registry.select(['alpha', 'alpha'])).toThrowError(/duplicate/i);
  });

  it('compiles an empty selection to an empty immutable plan', () => {
    const registry = createProviderRegistry();
    registry.register(makeDefinition('alpha', ['alpha_search']));
    registry.select([]);
    const compiled = registry.compile({ bindings, compatibility: {} });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.registry.tools.size).toBe(0);
      expect(compiled.registry.providers.size).toBe(0);
    }
  });

  it('compiles two providers and resolves exact public names', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha', ['alpha_search', 'alpha_read']);
    const beta = makeDefinition('beta', ['beta_doc']);
    registry.register(alpha);
    registry.register(beta);
    registry.select(['alpha', 'beta']);
    registry.configure('alpha', { mode: 'fast', maxResults: 10 });
    registry.configure('beta', { mode: 'slow' });
    const compiled = registry.compile({
      bindings,
      compatibility: { ...compatibilityFor(alpha), ...compatibilityFor(beta) },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const hit = compiled.registry.resolveTool('alpha_search');
    expect(hit?.providerId).toBe('alpha');
    expect(hit?.capabilityName).toBe('alpha_search');
    expect(hit?.requiredScopes).toEqual(['probe:use']);
    expect(compiled.registry.resolveTool('missing_tool')).toBeUndefined();
  });

  it('keeps provider values isolated: reconfiguring one leaves the other unchanged', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha', ['alpha_search']);
    const beta = makeDefinition('beta', ['beta_doc']);
    registry.register(alpha);
    registry.register(beta);
    registry.select(['alpha', 'beta']);
    registry.configure('alpha', { mode: 'fast' });
    registry.configure('beta', { mode: 'slow' });
    const first = registry.compile({
      bindings,
      compatibility: { ...compatibilityFor(alpha), ...compatibilityFor(beta) },
    });
    expect(first.ok).toBe(true);
    registry.configure('alpha', { mode: 'slow', maxResults: 99 });
    const second = registry.compile({
      bindings,
      compatibility: { ...compatibilityFor(alpha), ...compatibilityFor(beta) },
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.registry.providers.get('alpha')?.values).toEqual({ mode: 'fast' });
    expect(second.registry.providers.get('alpha')?.values).toEqual({
      mode: 'slow',
      maxResults: 99,
    });
    expect(second.registry.providers.get('beta')?.values).toEqual({ mode: 'slow' });
  });

  it('retains the previous validated plan when a candidate fails', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha', ['alpha_search']);
    registry.register(alpha);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const good = registry.compile({ bindings, compatibility: compatibilityFor(alpha) });
    expect(good.ok).toBe(true);
    expect(() => registry.configure('alpha', { mode: 'warp-speed' })).toThrowError(
      /unknown_parameter|not an allowed enum member/,
    );
    expect(registry.active()?.providers.get('alpha')?.values).toEqual({ mode: 'fast' });
    const bad = registry.compile({
      bindings,
      compatibility: { alpha: { manifestDigest: 'deadbeef' } },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.diagnostics.some((d) => d.code === 'compatibility_mismatch')).toBe(true);
    expect(registry.active()?.providers.get('alpha')?.values).toEqual({ mode: 'fast' });
  });

  it('refuses tool-name collisions across providers before activation', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha', ['shared_tool']);
    const beta = makeDefinition('beta', ['shared_tool']);
    registry.register(alpha);
    registry.register(beta);
    registry.select(['alpha', 'beta']);
    registry.configure('alpha', { mode: 'fast' });
    registry.configure('beta', { mode: 'fast' });
    const compiled = registry.compile({
      bindings,
      compatibility: { ...compatibilityFor(alpha), ...compatibilityFor(beta) },
    });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnostics.some((d) => d.code === 'duplicate_tool')).toBe(true);
  });

  it('refuses a tool without a handler binding', () => {
    const registry = createProviderRegistry();
    const def = makeDefinition('alpha', ['alpha_search']);
    delete def.toolValues['alpha_search'];
    registry.register(def);
    registry.select(['alpha']);
    registry.configure('alpha', { mode: 'fast' });
    const compiled = registry.compile({ bindings, compatibility: compatibilityFor(def) });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.diagnostics.some((d) => d.code === 'missing_handler')).toBe(true);
  });

  it('rejects invalid manifest versions and unknown configuration keys', () => {
    const registry = createProviderRegistry();
    const def = makeDefinition('alpha', ['alpha_search']);
    def.manifest.version = 'not-a-version';
    expect(() => registry.register(def)).toThrowError(/version/i);
    const registry2 = createProviderRegistry();
    registry2.register(makeDefinition('alpha', ['alpha_search']));
    registry2.select(['alpha']);
    expect(() => registry2.configure('alpha', { mode: 'fast', nope: 1 })).toThrowError(
      /unknown_parameter/,
    );
    expect(() => registry2.configure('beta', { mode: 'fast' })).toThrowError(
      /unselected provider|unknown provider/i,
    );
  });

  it('freezes compiled values: later caller mutation cannot change the plan', () => {
    const registry = createProviderRegistry();
    const alpha = makeDefinition('alpha', ['alpha_search']);
    registry.register(alpha);
    registry.select(['alpha']);
    const values = { mode: 'fast' };
    registry.configure('alpha', values);
    const compiled = registry.compile({ bindings, compatibility: compatibilityFor(alpha) });
    expect(compiled.ok).toBe(true);
    values.mode = 'slow';
    (alpha.toolValues['alpha_search']!.values as Record<string, unknown>).limit = 999;
    if (!compiled.ok) return;
    expect(compiled.registry.providers.get('alpha')?.values).toEqual({ mode: 'fast' });
    expect(compiled.registry.resolveTool('alpha_search')?.values).toEqual({ limit: 20 });
  });
});
