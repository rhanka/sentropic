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
  type ApprovedToolBinding,
  type ApprovedToolSnapshot,
  type ToolConfigurationHandlerBinding,
  type ToolPolicyOverlay,
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

const consumerDigest = computeCompatibilityDigest(manifest);

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

const strictGates = {
  requiresElicitation: true,
  requiresHumanConfirmation: true,
  requiresPrincipalGate: true,
  requiresPolicy: true,
};

const gatedManifest: AppMcpProviderManifest = {
  ...manifest,
  tools: [
    { ...searchTool, gates: strictGates, freshness: { maxAgeSeconds: 300, acr: ['a1'], amr: ['m1'], stepUp: 'auth' as const } },
    { ...readTool, gates: strictGates },
  ],
};

const gatedDigest = computeCompatibilityDigest(gatedManifest);

function snapshotFor(targetManifest: AppMcpProviderManifest, bindings: ApprovedToolBinding[]): ApprovedToolSnapshot {
  const snapshot = {
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    providerId: targetManifest.providerId,
    revision: 'rev-1',
    manifestDigest: computeManifestDigest(targetManifest),
    providerVersion: targetManifest.version,
    platformVersion: '0.3.0',
    compatibilityDigest: computeCompatibilityDigest(targetManifest),
    provenance: {
      approvalRef: 'approval-synth-1',
      revision: 'rev-1',
      manifestDigest: computeManifestDigest(targetManifest),
      reviewedBy: ['reviewer-1'],
    },
    bindings,
  };
  return { ...snapshot, provenance: { ...snapshot.provenance, payloadDigest: computePayloadDigest(snapshot) } };
}

function gatedBindings(policy: ApprovedToolBinding['policy']): ApprovedToolBinding[] {
  return [
    { toolName: 'synth_search', capabilityRef: 'synth_search', handlerId: 'local-search', values: { maxResults: 20, mode: 'fast' }, ...(policy === undefined ? {} : { policy }) },
    { toolName: 'synth_read', capabilityRef: 'synth_read', handlerId: 'local-read', values: { maxChars: 1200, redact: true } },
  ];
}

function reseal(snapshot: ApprovedToolSnapshot): ApprovedToolSnapshot {
  snapshot.provenance = { ...snapshot.provenance, payloadDigest: computePayloadDigest(snapshot) };
  return snapshot;
}

const noteHandlers: Record<string, ToolConfigurationHandlerBinding> = {
  'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: {
    type: 'object',
    properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, note: { type: 'string', maxLength: 200 }, tags: { type: 'array', items: { type: 'string' } } },
    required: ['maxResults'], additionalProperties: false } },
  'local-read': handlers['local-read'],
};

describe('tool-configuration compiler — synthetic providers only', () => {
  it('compiles two synthetic tools with distinct settings on the intended binding only', () => {
    const result = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
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

  it('is deterministic across round trips and key order', () => {
    const first = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
    const second = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(canonicalJson(first.config)).toBe(canonicalJson(second.config));
    expect(sha256Hex(canonicalJson(first.config))).toBe(sha256Hex(canonicalJson(second.config)));
    expect(computeManifestDigest(manifest)).toBe(computeManifestDigest(manifest));
    expect(computeCompatibilityDigest(manifest)).toBe(computeCompatibilityDigest(manifest));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('rejects a wrong schema version before activation', () => {
    const snapshot = { ...buildSnapshot(), schemaVersion: 'v9' };
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'invalid_schema_version')).toBe(true);
  });

  it('rejects an unknown handler', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings[0] = { ...snapshot.bindings[0], handlerId: 'no-such-handler' };
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'unknown_handler')).toBe(true);
  });

  it('rejects a handler capability mismatch', () => {
    const badHandlers = {
      ...handlers,
      'local-search': { handlerId: 'local-search', capabilityRef: 'synth_read', configSchema: searchSchema },
    };
    const result = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: badHandlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'handler_capability_mismatch')).toBe(true);
  });

  it('rejects a duplicate external name', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings.push({ ...snapshot.bindings[0] });
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'duplicate_tool_name')).toBe(true);
  });

  it('rejects a missing binding for a manifest tool', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings = [snapshot.bindings[0]];
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'missing_binding')).toBe(true);
  });

  it('rejects an unknown tool and a capability rename', () => {
    const unknown = buildSnapshot();
    unknown.bindings[1] = { ...unknown.bindings[1], toolName: 'synth_unknown', capabilityRef: 'synth_unknown' };
    const unknownResult = compileToolConfiguration({ snapshot: unknown, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics.some((entry) => entry.code === 'unknown_tool')).toBe(true);
    }
    const renamed = buildSnapshot();
    renamed.bindings[0] = { ...renamed.bindings[0], capabilityRef: 'synth_read' };
    const renamedResult = compileToolConfiguration({ snapshot: renamed, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(renamedResult.ok).toBe(false);
    if (!renamedResult.ok) {
      expect(renamedResult.diagnostics.some((entry) => entry.code === 'capability_ref_mismatch')).toBe(true);
    }
  });

  it('rejects policy weakening before activation', () => {
    const droppedScope = buildSnapshot();
    droppedScope.bindings[0] = { ...droppedScope.bindings[0], policy: { requiredScopes: [] } };
    const dropped = compileToolConfiguration({ snapshot: droppedScope, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) {
      expect(dropped.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
    const relaxedRedaction = buildSnapshot();
    relaxedRedaction.bindings[1] = { ...relaxedRedaction.bindings[1], policy: { redactionClass: 'none' } };
    const relaxed = compileToolConfiguration({ snapshot: relaxedRedaction, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(relaxed.ok).toBe(false);
    if (!relaxed.ok) {
      expect(relaxed.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
    const relaxedFreshness = buildSnapshot();
    relaxedFreshness.bindings[1] = {
      ...relaxedFreshness.bindings[1],
      policy: { freshness: { maxAgeSeconds: 3600, stepUp: 'auth' } },
    };
    const stale = compileToolConfiguration({ snapshot: relaxedFreshness, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
  });

  it('merges gates field by field and rejects per-field weakening', () => {
    const empty = snapshotFor(gatedManifest, gatedBindings({}));
    const emptyResult = compileToolConfiguration({ snapshot: empty, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(emptyResult.ok).toBe(true);
    if (!emptyResult.ok) return;
    expect(emptyResult.config.tools.find((tool) => tool.toolName === 'synth_search')?.gates).toEqual(strictGates);
    for (const key of ['requiresElicitation', 'requiresHumanConfirmation', 'requiresPrincipalGate', 'requiresPolicy'] as const) {
      const dropped = snapshotFor(gatedManifest, gatedBindings({ gates: { [key]: false } as ToolPolicyOverlay['gates'] }));
      const droppedResult = compileToolConfiguration({ snapshot: dropped, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
      expect(droppedResult.ok).toBe(false);
      if (!droppedResult.ok) {
        expect(droppedResult.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
      }
    }
  });

  it('requires a finite bounded maxAge and keeps acr/amr', () => {
    const partial = snapshotFor(gatedManifest, gatedBindings({ freshness: { stepUp: 'auth' } }));
    const partialResult = compileToolConfiguration({ snapshot: partial, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(partialResult.ok).toBe(true);
    if (partialResult.ok) {
      expect(partialResult.config.tools.find((tool) => tool.toolName === 'synth_search')?.freshness).toEqual({ maxAgeSeconds: 300, acr: ['a1'], amr: ['m1'], stepUp: 'auth' });
    }
    const tighter = snapshotFor(gatedManifest, gatedBindings({ freshness: { maxAgeSeconds: 100, stepUp: 'auth' } }));
    const tighterResult = compileToolConfiguration({ snapshot: tighter, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(tighterResult.ok).toBe(true);
    const badOverlays = [
      { maxAgeSeconds: 0, stepUp: 'auth' },
      { maxAgeSeconds: 3600, stepUp: 'auth' },
      { maxAgeSeconds: 100, stepUp: 'auth', acr: [] as string[] },
      { maxAgeSeconds: 100, stepUp: 'auth', amr: [] as string[] },
      { maxAgeSeconds: 100, stepUp: 'scope' },
    ];
    for (const freshness of badOverlays) {
      const rejected = snapshotFor(gatedManifest, gatedBindings({ freshness: freshness as ToolPolicyOverlay['freshness'] }));
      const rejectedResult = compileToolConfiguration({ snapshot: rejected, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
      expect(rejectedResult.ok).toBe(false);
      if (!rejectedResult.ok) {
        expect(rejectedResult.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
      }
    }
    const nanSnapshot = snapshotFor(gatedManifest, gatedBindings({ freshness: { maxAgeSeconds: 100, stepUp: 'auth' } }));
    nanSnapshot.bindings[0] = { ...nanSnapshot.bindings[0], policy: { freshness: { maxAgeSeconds: Number.NaN, stepUp: 'auth' } } };
    const nanResult = compileToolConfiguration({ snapshot: nanSnapshot, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(nanResult.ok).toBe(false);
    if (!nanResult.ok) {
      expect(nanResult.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
  });

  it('returns typed diagnostics for malformed overlays', () => {
    const cases: Array<{ policy: unknown }> = [
      { policy: null },
      { policy: { idempotency: null } },
      { policy: { gates: null } },
      { policy: { freshness: null } },
      { policy: { requiredScopes: ['synth:search', 123] } },
      { policy: { requiredScope: ['synth:search'] } },
    ];
    for (const { policy } of cases) {
      const snapshot = snapshotFor(gatedManifest, gatedBindings(policy as ToolPolicyOverlay));
      const result = compileToolConfiguration({ snapshot, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
      }
    }
  });

  it('accepts strengthening overlays and exposes effective scopes', () => {
    const snapshot = snapshotFor(gatedManifest, gatedBindings({ requiredScopes: ['synth:search', 'synth:extra'], redactionClass: 'secret' }));
    const result = compileToolConfiguration({ snapshot, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.tools.find((tool) => tool.toolName === 'synth_search')?.requiredScopes).toEqual(['synth:search', 'synth:extra']);
    expect(result.config.tools.find((tool) => tool.toolName === 'synth_search')?.redactionClass).toBe('secret');
  });

  it('rejects unknown keys and invalid values', () => {
    const unknownKey = buildSnapshot();
    unknownKey.bindings[0] = { ...unknownKey.bindings[0], values: { maxResults: 20, extra: true } };
    const unknownResult = compileToolConfiguration({ snapshot: unknownKey, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics.some((entry) => entry.code === 'unknown_config_key')).toBe(true);
    }
    const outOfBounds = buildSnapshot();
    outOfBounds.bindings[0] = { ...outOfBounds.bindings[0], values: { maxResults: 5000 } };
    const boundsResult = compileToolConfiguration({ snapshot: outOfBounds, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(boundsResult.ok).toBe(false);
    if (!boundsResult.ok) {
      expect(boundsResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
    const wrongType = buildSnapshot();
    wrongType.bindings[1] = { ...wrongType.bindings[1], values: { maxChars: 'many' } };
    const typeResult = compileToolConfiguration({ snapshot: wrongType, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(typeResult.ok).toBe(false);
    if (!typeResult.ok) {
      expect(typeResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
  });

  it('rejects non-canonical values instead of coercing them', () => {
    expect(() => canonicalJson({ a: undefined as unknown as null })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson(new Date('2026-01-01T00:00:00Z'))).toThrow(TypeError);
    const cyclic: Record<string, unknown> = { self: null };
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });

  it('rejects unsupported schema keywords and non-finite numbers', () => {
    const patternedHandlers = { ...handlers,
      'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: {
        type: 'object',
        properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, mode: { type: 'string', enum: ['fast', 'deep'], pattern: '^f' } },
        required: ['maxResults'], additionalProperties: false } } };
    const keywordResult = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: patternedHandlers, compatibilityDigest: consumerDigest });
    expect(keywordResult.ok).toBe(false);
    if (!keywordResult.ok) {
      expect(keywordResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
    const infinite = buildSnapshot();
    infinite.bindings[0] = { ...infinite.bindings[0], values: { maxResults: Number.POSITIVE_INFINITY } };
    const infiniteResult = compileToolConfiguration({ snapshot: infinite, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(infiniteResult.ok).toBe(false);
    if (!infiniteResult.ok) {
      expect(infiniteResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
  });

  it('rejects digest mismatches', () => {
    const manifestMismatch = { ...buildSnapshot(), manifestDigest: '0'.repeat(64) };
    const manifestResult = compileToolConfiguration({ snapshot: manifestMismatch, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(manifestResult.ok).toBe(false);
    if (!manifestResult.ok) {
      expect(
        manifestResult.diagnostics.some((entry) => entry.code === 'manifest_digest_mismatch'),
      ).toBe(true);
    }
    const compatMismatch = { ...buildSnapshot(), compatibilityDigest: '1'.repeat(64) };
    const compatResult = compileToolConfiguration({ snapshot: compatMismatch, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(compatResult.ok).toBe(false);
    if (!compatResult.ok) {
      expect(
        compatResult.diagnostics.some((entry) => entry.code === 'compatibility_digest_mismatch'),
      ).toBe(true);
    }
  });

  it('rejects unknown keys, version drift, duplicate tools and handler mismatches', () => {
    const typo = { ...buildSnapshot(), requiredScope: ['synth:search'] };
    const typoResult = compileToolConfiguration({ snapshot: typo, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(typoResult.ok).toBe(false);
    if (!typoResult.ok) {
      expect(typoResult.diagnostics.some((entry) => entry.code === 'malformed_snapshot')).toBe(true);
    }
    const drifted = { ...buildSnapshot(), providerVersion: '9.9.9' };
    const driftResult = compileToolConfiguration({ snapshot: drifted, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(driftResult.ok).toBe(false);
    if (!driftResult.ok) {
      expect(driftResult.diagnostics.some((entry) => entry.code === 'invalid_identity')).toBe(true);
    }
    const dupManifest = { ...manifest, tools: [searchTool, searchTool] };
    const dupBase = { ...buildSnapshot(), manifestDigest: computeManifestDigest(dupManifest), compatibilityDigest: computeCompatibilityDigest(dupManifest) };
    dupBase.provenance = { ...dupBase.provenance, manifestDigest: dupBase.manifestDigest, payloadDigest: computePayloadDigest(dupBase) };
    const dupResult = compileToolConfiguration({ snapshot: dupBase, manifest: dupManifest, handlers, compatibilityDigest: computeCompatibilityDigest(dupManifest) });
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) {
      expect(dupResult.diagnostics.some((entry) => entry.code === 'duplicate_tool_name')).toBe(true);
    }
    const mismatched = { ...handlers, 'other-key': handlers['local-search'] };
    const mismatchResult = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: mismatched, compatibilityDigest: consumerDigest });
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) {
      expect(mismatchResult.diagnostics.some((entry) => entry.path === 'handlers.other-key')).toBe(true);
    }
  });

  it('binds the consumer-supplied compatibility digest', () => {
    const tampered = compileToolConfiguration({
      snapshot: buildSnapshot(),
      manifest,
      handlers,
      compatibilityDigest: '2'.repeat(64),
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.diagnostics.some((entry) => entry.code === 'compatibility_digest_mismatch')).toBe(true);
    }
    const missing = compileToolConfiguration({
      snapshot: buildSnapshot(),
      manifest,
      handlers,
      compatibilityDigest: '',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics.some((entry) => entry.code === 'compatibility_digest_mismatch')).toBe(true);
    }
  });

  it('rejects credentials, bearers, user data and executable values', () => {
    const credential = buildSnapshot();
    credential.bindings[0] = { ...credential.bindings[0], values: { maxResults: 20, api_key: 'secret' } };
    expect(compileToolConfiguration({ snapshot: credential, manifest, handlers, compatibilityDigest: consumerDigest }).ok).toBe(false);
    const bearer = buildSnapshot();
    bearer.bindings[0] = { ...bearer.bindings[0], values: { maxResults: 20, mode: 'Bearer abc' } };
    const bearerResult = compileToolConfiguration({ snapshot: bearer, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(bearerResult.ok).toBe(false);
    const owner = buildSnapshot();
    owner.bindings[0] = { ...owner.bindings[0], values: { maxResults: 20, ownerSub: 'user-1' } };
    expect(compileToolConfiguration({ snapshot: owner, manifest, handlers, compatibilityDigest: consumerDigest }).ok).toBe(false);
    const executable = buildSnapshot();
    executable.bindings[0] = { ...executable.bindings[0], values: { maxResults: 20, mode: 'https://example.test/x' } };
    expect(compileToolConfiguration({ snapshot: executable, manifest, handlers, compatibilityDigest: consumerDigest }).ok).toBe(false);
  });

  it('flags forbidden keys with the forbidden_content code', () => {
    const forbiddenKeys = ['refresh_token', 'id_token', 'client_secret', 'tenant_id', 'workspace_id', 'credentials', 'token', 'mySecretValue', 'apiKey'];
    for (const key of forbiddenKeys) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, [key]: 'x' } };
      const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content')).toBe(true);
      }
    }
  });

  it('traverses arrays and nested objects for forbidden content', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, tags: ['ok', 'Bearer abc'] } };
    const arrayResult = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(arrayResult.ok).toBe(false);
    if (!arrayResult.ok) {
      expect(arrayResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].values.tags[1]')).toBe(true);
    }
    const nested = buildSnapshot();
    nested.bindings[0] = { ...nested.bindings[0], values: { maxResults: 20, filters: { password: 'x' } } };
    const nestedResult = compileToolConfiguration({ snapshot: nested, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) {
      expect(nestedResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].values.filters.password')).toBe(true);
    }
  });

  it('blocks attacks but passes legitimate labels', () => {
    for (const note of ['Select a city', 'Update profile', 'Create report', 'Delete my account', 'node list']) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note, tags: ['paris', 'lyon'] } };
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(true);
    }
    const attacks = ['SELECT * FROM users WHERE id = 1', 'DROP TABLE users;', 'wss://example.test/x', 'javascript:alert(1)', '//host/path', 'node:fs', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', 'Bearer abc'];
    for (const note of attacks) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note } };
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content')).toBe(true);
      }
    }
  });

  it('rejects forged provenance bindings', () => {
    const diverged = buildSnapshot();
    diverged.provenance = { ...diverged.provenance, revision: 'rev-2' };
    reseal(diverged);
    const divergedResult = compileToolConfiguration({ snapshot: diverged, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(divergedResult.ok).toBe(false);
    if (!divergedResult.ok) {
      expect(divergedResult.diagnostics.some((entry) => entry.code === 'invalid_provenance')).toBe(true);
    }
    const noReviewers = buildSnapshot();
    noReviewers.provenance = { ...noReviewers.provenance, reviewedBy: [] };
    reseal(noReviewers);
    const reviewersResult = compileToolConfiguration({ snapshot: noReviewers, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(reviewersResult.ok).toBe(false);
    if (!reviewersResult.ok) {
      expect(reviewersResult.diagnostics.some((entry) => entry.code === 'invalid_provenance')).toBe(true);
    }
    const forged = buildSnapshot();
    forged.provenance = { ...forged.provenance, payloadDigest: 'f'.repeat(64) };
    const forgedResult = compileToolConfiguration({ snapshot: forged, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) {
      expect(forgedResult.diagnostics.some((entry) => entry.code === 'invalid_provenance')).toBe(true);
    }
    const missing = buildSnapshot();
    delete missing.provenance.payloadDigest;
    const missingResult = compileToolConfiguration({ snapshot: missing, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.some((entry) => entry.code === 'invalid_provenance')).toBe(true);
    }
  });

  it('never freezes caller inputs and isolates compiled values', () => {
    const snapshot = buildSnapshot();
    const manifestCopy = structuredClone(manifest);
    const result = compileToolConfiguration({ snapshot, manifest: manifestCopy, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(Object.isFrozen(snapshot.bindings[0].values)).toBe(false);
    expect(Object.isFrozen(manifestCopy)).toBe(false);
    expect(Object.isFrozen(manifestCopy.tools[0].gates)).toBe(false);
    snapshot.bindings[0].values['maxResults'] = 99;
    expect(result.config.tools.find((tool) => tool.toolName === 'synth_search')?.values).toEqual({ maxResults: 20, mode: 'fast' });
  });

  it('rejects foreign configurations on activate and counts generations', () => {
    const store = new ToolConfigurationStore();
    expect(store.getGeneration()).toBe(0);
    const valid = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const foreign = { ok: true as const, config: structuredClone(valid.config) };
    const rejected = store.activate(foreign);
    expect(rejected.ok).toBe(false);
    expect(store.getActive()).toBeNull();
    expect(store.getGeneration()).toBe(0);
    expect(store.activate(valid).ok).toBe(true);
    expect(store.getGeneration()).toBe(1);
    expect(store.activate(valid).ok).toBe(true);
    expect(store.getGeneration()).toBe(2);
  });

  it('retains the active generation when a candidate is rejected', () => {
    const store = new ToolConfigurationStore();
    const valid = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
    expect(store.compileAndActivate({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest }).ok).toBe(true);
    expect(valid.ok).toBe(true);
    const before = store.getActive();
    expect(before).not.toBeNull();
    const invalidSnapshot = buildSnapshot();
    invalidSnapshot.bindings[0] = { ...invalidSnapshot.bindings[0], handlerId: 'missing' };
    const rejected = store.compileAndActivate({ snapshot: invalidSnapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(rejected.ok).toBe(false);
    expect(store.getActive()).toBe(before);
  });

  it('fails a cold start without a valid embedded configuration', () => {
    const store = new ToolConfigurationStore();
    const invalidSnapshot = buildSnapshot();
    invalidSnapshot.bindings = [];
    expect(() => store.coldStart({ snapshot: invalidSnapshot, manifest, handlers, compatibilityDigest: consumerDigest })).toThrow();
    expect(store.getActive()).toBeNull();
  });

  it('performs zero configuration I/O and reloads identically in a fresh holder', async () => {
    const previousFetch = (globalThis as Record<string, unknown>)['fetch'];
    let calls = 0;
    (globalThis as Record<string, unknown>)['fetch'] = async () => {
      calls += 1;
      throw new Error('network must not be used');
    };
    try {
      const snapshot = buildSnapshot();
      const first = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
      expect(first.ok).toBe(true);
      const freshStore = new ToolConfigurationStore();
      const activated = freshStore.compileAndActivate({
        snapshot: structuredClone(snapshot),
        manifest: structuredClone(manifest),
        handlers,
        compatibilityDigest: consumerDigest,
      });
      expect(activated.ok).toBe(true);
      if (!first.ok || !activated.ok) return;
      expect(canonicalJson(activated.config)).toBe(canonicalJson(first.config));
      expect(calls).toBe(0);
    } finally {
      if (previousFetch === undefined) {
        delete (globalThis as Record<string, unknown>)['fetch'];
      } else {
        (globalThis as Record<string, unknown>)['fetch'] = previousFetch;
      }
    }
  });
});
