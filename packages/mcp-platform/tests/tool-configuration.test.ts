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

  it('is deterministic across round trips and key order', () => {
    const first = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers });
    const second = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers });
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
    const result = compileToolConfiguration({ snapshot, manifest, handlers });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'invalid_schema_version')).toBe(true);
  });

  it('rejects an unknown handler', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings[0] = { ...snapshot.bindings[0], handlerId: 'no-such-handler' };
    const result = compileToolConfiguration({ snapshot, manifest, handlers });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'unknown_handler')).toBe(true);
  });

  it('rejects a handler capability mismatch', () => {
    const badHandlers = {
      ...handlers,
      'local-search': { handlerId: 'local-search', capabilityRef: 'synth_read', configSchema: searchSchema },
    };
    const result = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: badHandlers });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'handler_capability_mismatch')).toBe(true);
  });

  it('rejects a duplicate external name', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings.push({ ...snapshot.bindings[0] });
    const result = compileToolConfiguration({ snapshot, manifest, handlers });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'duplicate_tool_name')).toBe(true);
  });

  it('rejects a missing binding for a manifest tool', () => {
    const snapshot = buildSnapshot();
    snapshot.bindings = [snapshot.bindings[0]];
    const result = compileToolConfiguration({ snapshot, manifest, handlers });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((entry) => entry.code === 'missing_binding')).toBe(true);
  });

  it('rejects an unknown tool and a capability rename', () => {
    const unknown = buildSnapshot();
    unknown.bindings[1] = { ...unknown.bindings[1], toolName: 'synth_unknown', capabilityRef: 'synth_unknown' };
    const unknownResult = compileToolConfiguration({ snapshot: unknown, manifest, handlers });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics.some((entry) => entry.code === 'unknown_tool')).toBe(true);
    }
    const renamed = buildSnapshot();
    renamed.bindings[0] = { ...renamed.bindings[0], capabilityRef: 'synth_read' };
    const renamedResult = compileToolConfiguration({ snapshot: renamed, manifest, handlers });
    expect(renamedResult.ok).toBe(false);
    if (!renamedResult.ok) {
      expect(renamedResult.diagnostics.some((entry) => entry.code === 'capability_ref_mismatch')).toBe(true);
    }
  });

  it('rejects policy weakening before activation', () => {
    const droppedScope = buildSnapshot();
    droppedScope.bindings[0] = { ...droppedScope.bindings[0], policy: { requiredScopes: [] } };
    const dropped = compileToolConfiguration({ snapshot: droppedScope, manifest, handlers });
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) {
      expect(dropped.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
    const relaxedRedaction = buildSnapshot();
    relaxedRedaction.bindings[1] = { ...relaxedRedaction.bindings[1], policy: { redactionClass: 'none' } };
    const relaxed = compileToolConfiguration({ snapshot: relaxedRedaction, manifest, handlers });
    expect(relaxed.ok).toBe(false);
    if (!relaxed.ok) {
      expect(relaxed.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
    const relaxedFreshness = buildSnapshot();
    relaxedFreshness.bindings[1] = {
      ...relaxedFreshness.bindings[1],
      policy: { freshness: { maxAgeSeconds: 3600, stepUp: 'auth' } },
    };
    const stale = compileToolConfiguration({ snapshot: relaxedFreshness, manifest, handlers });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
  });

  it('rejects unknown keys and invalid values', () => {
    const unknownKey = buildSnapshot();
    unknownKey.bindings[0] = { ...unknownKey.bindings[0], values: { maxResults: 20, extra: true } };
    const unknownResult = compileToolConfiguration({ snapshot: unknownKey, manifest, handlers });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) {
      expect(unknownResult.diagnostics.some((entry) => entry.code === 'unknown_config_key')).toBe(true);
    }
    const outOfBounds = buildSnapshot();
    outOfBounds.bindings[0] = { ...outOfBounds.bindings[0], values: { maxResults: 5000 } };
    const boundsResult = compileToolConfiguration({ snapshot: outOfBounds, manifest, handlers });
    expect(boundsResult.ok).toBe(false);
    if (!boundsResult.ok) {
      expect(boundsResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
    const wrongType = buildSnapshot();
    wrongType.bindings[1] = { ...wrongType.bindings[1], values: { maxChars: 'many' } };
    const typeResult = compileToolConfiguration({ snapshot: wrongType, manifest, handlers });
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
    const keywordResult = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: patternedHandlers });
    expect(keywordResult.ok).toBe(false);
    if (!keywordResult.ok) {
      expect(keywordResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
    const infinite = buildSnapshot();
    infinite.bindings[0] = { ...infinite.bindings[0], values: { maxResults: Number.POSITIVE_INFINITY } };
    const infiniteResult = compileToolConfiguration({ snapshot: infinite, manifest, handlers });
    expect(infiniteResult.ok).toBe(false);
    if (!infiniteResult.ok) {
      expect(infiniteResult.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
  });

  it('rejects digest mismatches', () => {
    const manifestMismatch = { ...buildSnapshot(), manifestDigest: '0'.repeat(64) };
    const manifestResult = compileToolConfiguration({ snapshot: manifestMismatch, manifest, handlers });
    expect(manifestResult.ok).toBe(false);
    if (!manifestResult.ok) {
      expect(
        manifestResult.diagnostics.some((entry) => entry.code === 'manifest_digest_mismatch'),
      ).toBe(true);
    }
    const compatMismatch = { ...buildSnapshot(), compatibilityDigest: '1'.repeat(64) };
    const compatResult = compileToolConfiguration({ snapshot: compatMismatch, manifest, handlers });
    expect(compatResult.ok).toBe(false);
    if (!compatResult.ok) {
      expect(
        compatResult.diagnostics.some((entry) => entry.code === 'compatibility_digest_mismatch'),
      ).toBe(true);
    }
  });

  it('rejects credentials, bearers, user data and executable values', () => {
    const credential = buildSnapshot();
    credential.bindings[0] = { ...credential.bindings[0], values: { maxResults: 20, api_key: 'secret' } };
    expect(compileToolConfiguration({ snapshot: credential, manifest, handlers }).ok).toBe(false);
    const bearer = buildSnapshot();
    bearer.bindings[0] = { ...bearer.bindings[0], values: { maxResults: 20, mode: 'Bearer abc' } };
    const bearerResult = compileToolConfiguration({ snapshot: bearer, manifest, handlers });
    expect(bearerResult.ok).toBe(false);
    const owner = buildSnapshot();
    owner.bindings[0] = { ...owner.bindings[0], values: { maxResults: 20, ownerSub: 'user-1' } };
    expect(compileToolConfiguration({ snapshot: owner, manifest, handlers }).ok).toBe(false);
    const executable = buildSnapshot();
    executable.bindings[0] = { ...executable.bindings[0], values: { maxResults: 20, mode: 'https://example.test/x' } };
    expect(compileToolConfiguration({ snapshot: executable, manifest, handlers }).ok).toBe(false);
  });

  it('retains the active generation when a candidate is rejected', () => {
    const store = new ToolConfigurationStore();
    const valid = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers });
    expect(store.compileAndActivate({ snapshot: buildSnapshot(), manifest, handlers }).ok).toBe(true);
    expect(valid.ok).toBe(true);
    const before = store.getActive();
    expect(before).not.toBeNull();
    const invalidSnapshot = buildSnapshot();
    invalidSnapshot.bindings[0] = { ...invalidSnapshot.bindings[0], handlerId: 'missing' };
    const rejected = store.compileAndActivate({ snapshot: invalidSnapshot, manifest, handlers });
    expect(rejected.ok).toBe(false);
    expect(store.getActive()).toBe(before);
  });

  it('fails a cold start without a valid embedded configuration', () => {
    const store = new ToolConfigurationStore();
    const invalidSnapshot = buildSnapshot();
    invalidSnapshot.bindings = [];
    expect(() => store.coldStart({ snapshot: invalidSnapshot, manifest, handlers })).toThrow();
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
      const first = compileToolConfiguration({ snapshot, manifest, handlers });
      expect(first.ok).toBe(true);
      const freshStore = new ToolConfigurationStore();
      const activated = freshStore.compileAndActivate({
        snapshot: structuredClone(snapshot),
        manifest: structuredClone(manifest),
        handlers,
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
