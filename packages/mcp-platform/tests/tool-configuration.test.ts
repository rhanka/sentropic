/**
 * Lot 1a — generic tool-configuration codec/compiler tests.
 *
 * Synthetic providers only. No Immo fixture, no SDK, no network, no registry.
 * Covers deterministic round trips/digests, independent settings on two tools,
 * strict schema/version/handler checks, duplicates, missing bindings, weakened
 * policy, rejection preserving active state, and the zero-I/O sentinel.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import {
  TOOL_CONFIGURATION_PLATFORM_VERSION,
  TOOL_CONFIGURATION_SCHEMA_VERSION,
  ToolConfigurationStore,
  canonicalJson,
  compileToolConfiguration,
  computeCompatibilityDigest,
  computeHandlersDigest,
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

// Frozen reference digests for the synthetic fixture above (M5/M6): any
// algorithm or fixture change fails these before it can drift silently.
const GOLDEN_MANIFEST_DIGEST = '1b3514cd8e7d0991f9dadc4061da7950a04f2bcf655c4be0f04b4bee28a8ea4d';
const GOLDEN_PAYLOAD_DIGEST = 'b3da6d59aa52fcd86acdb8e5d2adf93c31727803392b73c8a1525dc69eef86c1';
const GOLDEN_COMPILED_DIGEST = '4d2f74f29865fe78787cd9b85d7d2b80c65968da740760c7b478d97ae853cb37';

function buildSnapshot(): ApprovedToolSnapshot {
  const revision = 'rev-1';
  const base = {
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    providerId: 'synth-provider',
    revision,
    manifestDigest: computeManifestDigest(manifest),
    providerVersion: '0.0.0',
    platformVersion: TOOL_CONFIGURATION_PLATFORM_VERSION,
    compatibilityDigest: computeCompatibilityDigest(manifest),
    handlersDigest: computeHandlersDigest(handlers),
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
    platformVersion: TOOL_CONFIGURATION_PLATFORM_VERSION,
    compatibilityDigest: computeCompatibilityDigest(targetManifest),
    handlersDigest: computeHandlersDigest(handlers),
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

// Strict-policy fixture (R2-M3): every weakening check has a baseline value
// it can drop, so each removal is caught by a discriminating test.
const strictTool: CapabilityTool = {
  kind: 'tool',
  name: 'synth_write',
  description: 'Write a synthetic record.',
  requiredScopes: ['synth:write'],
  requiredClaims: ['c1'],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'patch',
  mutatesExternalSystem: true,
  idempotency: { required: true, scope: 'tenant' },
  gates: readOnlyGates,
};

const strictManifest: AppMcpProviderManifest = {
  ...manifest,
  tools: [strictTool],
};

const strictSchema = {
  type: 'object',
  properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, ratio: { type: 'number' } },
  required: ['maxResults'],
  additionalProperties: false,
};

const strictHandlers: Record<string, ToolConfigurationHandlerBinding> = {
  'local-write': { handlerId: 'local-write', capabilityRef: 'synth_write', configSchema: strictSchema },
};

function strictSnapshot(bindings: ApprovedToolBinding[]): ApprovedToolSnapshot {
  const snapshot = {
    schemaVersion: TOOL_CONFIGURATION_SCHEMA_VERSION,
    providerId: strictManifest.providerId,
    revision: 'rev-1',
    manifestDigest: computeManifestDigest(strictManifest),
    providerVersion: strictManifest.version,
    platformVersion: TOOL_CONFIGURATION_PLATFORM_VERSION,
    compatibilityDigest: computeCompatibilityDigest(strictManifest),
    handlersDigest: computeHandlersDigest(strictHandlers),
    provenance: {
      approvalRef: 'approval-synth-1',
      revision: 'rev-1',
      manifestDigest: computeManifestDigest(strictManifest),
      reviewedBy: ['reviewer-1'],
    },
    bindings,
  };
  return { ...snapshot, provenance: { ...snapshot.provenance, payloadDigest: computePayloadDigest(snapshot) } };
}

function strictBindings(policy: ApprovedToolBinding['policy']): ApprovedToolBinding[] {
  return [
    { toolName: 'synth_write', capabilityRef: 'synth_write', handlerId: 'local-write', values: { maxResults: 20, ratio: 0.5 }, ...(policy === undefined ? {} : { policy }) },
  ];
}

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

  it('is stable across key, binding and tool order permutations', () => {
    expect(computeManifestDigest(manifest)).toBe(GOLDEN_MANIFEST_DIGEST);
    const snapshot = buildSnapshot();
    expect(computePayloadDigest(snapshot)).toBe(GOLDEN_PAYLOAD_DIGEST);
    const baseResult = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(baseResult.ok).toBe(true);
    if (!baseResult.ok) return;
    expect(sha256Hex(canonicalJson(baseResult.config))).toBe(GOLDEN_COMPILED_DIGEST);
    // Key order alone never changes the digest; binding order does (arrays
    // keep order), so the reordered payload is resealed before compiling.
    const keyShuffled = {
      schemaVersion: snapshot.schemaVersion,
      revision: snapshot.revision,
      providerId: snapshot.providerId,
      bindings: snapshot.bindings.map((binding) => ({ handlerId: binding.handlerId, values: { ...binding.values }, toolName: binding.toolName, capabilityRef: binding.capabilityRef })),
      provenance: { payloadDigest: snapshot.provenance.payloadDigest, manifestDigest: snapshot.provenance.manifestDigest, approvalRef: snapshot.provenance.approvalRef, revision: snapshot.provenance.revision, reviewedBy: [...snapshot.provenance.reviewedBy] },
      manifestDigest: snapshot.manifestDigest,
      providerVersion: snapshot.providerVersion,
      platformVersion: snapshot.platformVersion,
      compatibilityDigest: snapshot.compatibilityDigest,
      handlersDigest: snapshot.handlersDigest,
    };
    expect(computePayloadDigest(keyShuffled)).toBe(GOLDEN_PAYLOAD_DIGEST);
    const reordered = { ...keyShuffled, bindings: [...keyShuffled.bindings].reverse() };
    const resealed = { ...reordered, provenance: { ...reordered.provenance, payloadDigest: computePayloadDigest(reordered) } };
    const roundTripped = JSON.parse(JSON.stringify(resealed)) as ApprovedToolSnapshot;
    const reorderedManifest = { ...manifest, tools: [...manifest.tools].reverse() };
    const permutedResult = compileToolConfiguration({ snapshot: roundTripped, manifest: reorderedManifest, handlers, compatibilityDigest: consumerDigest });
    expect(permutedResult.ok).toBe(true);
    if (!permutedResult.ok || !baseResult.ok) return;
    // The compiler normalizes order into identical tools; only the
    // order-binding payloadDigest differs between the two approvals.
    expect(canonicalJson(permutedResult.config.tools)).toBe(canonicalJson(baseResult.config.tools));
    expect(permutedResult.config.payloadDigest).not.toBe(GOLDEN_PAYLOAD_DIGEST);
  });

  it('reproduces the compiled result in a separate process from packaged files', () => {
    // R2-M4: the artifact under test is the compiled package (`dist`), built
    // by `make build-mcp-platform` (a prerequisite of `make test-mcp-platform`).
    // The child imports no repository source: it loads the packaged
    // `tool-configuration.js` and its compiled result must equal this process.
    const distUrl = new URL('../dist/tool-configuration.js', import.meta.url).href;
    const snapshot = buildSnapshot();
    const expected = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers, compatibilityDigest: consumerDigest });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const payload = JSON.stringify({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    const script = `
const mod = await import(process.argv[1]);
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const parsed = JSON.parse(input);
  const result = mod.compileToolConfiguration(parsed);
  if (!result.ok) {
    process.stderr.write(JSON.stringify(result.diagnostics));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ canonical: mod.canonicalJson(result.config), payloadDigest: result.config.payloadDigest }));
});
`;
    let output: string;
    try {
      output = execFileSync(process.execPath, ['--input-type=module', '-e', script, distUrl], { input: payload, encoding: 'utf8' }) as string;
    } catch (error) {
      throw new Error(`separate-process packaged compile failed (run make build-mcp-platform first): ${(error as Error).message}`);
    }
    const parsed = JSON.parse(output) as { canonical: string; payloadDigest: string };
    expect(parsed.canonical).toBe(canonicalJson(expected.config));
    expect(parsed.payloadDigest).toBe(GOLDEN_PAYLOAD_DIGEST);
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

  it('rejects user-data and credential keys with code and path', () => {
    // Discriminating replacement for the former `.ok === false`-only test:
    // every key below is schema-valid, so only `forbidden_content` rejects it.
    const userSchema = {
      type: 'object',
      properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, ownerSub: { type: 'string' }, email: { type: 'string' }, sub: { type: 'string' }, api_key: { type: 'string' } },
      required: ['maxResults'],
      additionalProperties: false,
    };
    const userHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: userSchema } };
    for (const key of ['ownerSub', 'email', 'sub', 'api_key']) {
      const userSnapshot = buildSnapshot();
      userSnapshot.bindings[0] = { ...userSnapshot.bindings[0], values: { maxResults: 20, [key]: 'user-1' } };
      userSnapshot.handlersDigest = computeHandlersDigest(userHandlers);
      reseal(userSnapshot);
      const userResult = compileToolConfiguration({ snapshot: userSnapshot, manifest, handlers: userHandlers, compatibilityDigest: consumerDigest });
      expect(userResult.ok).toBe(false);
      if (!userResult.ok) {
        expect(userResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === `snapshot.bindings[0].values.${key}`)).toBe(true);
      }
    }
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
    snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, tags: ['ok', 'Bearer abcdefgh12345678'] } };
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
      // The approval below covers the note-handler table shape (R2-M2).
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(true);
    }
    const attacks = ['SELECT * FROM users WHERE id = 1', 'DROP TABLE users;', 'wss://example.test/x', 'javascript:alert(1)', '//host/path', 'node:fs', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', 'Bearer abcdefgh12345678'];
    for (const note of attacks) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note } };
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
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

  it('closes provenance to known keys and inspects its strings', () => {
    const tokenKey = buildSnapshot();
    (tokenKey.provenance as Record<string, unknown>)['accessToken'] = 'x';
    reseal(tokenKey);
    const tokenKeyResult = compileToolConfiguration({ snapshot: tokenKey, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(tokenKeyResult.ok).toBe(false);
    if (!tokenKeyResult.ok) {
      expect(tokenKeyResult.diagnostics.some((entry) => entry.code === 'invalid_provenance' && entry.path === 'snapshot.provenance.accessToken')).toBe(true);
    }
    const unknownKey = buildSnapshot();
    (unknownKey.provenance as Record<string, unknown>)['reviewedAt'] = '2026-01-01';
    reseal(unknownKey);
    const unknownKeyResult = compileToolConfiguration({ snapshot: unknownKey, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(unknownKeyResult.ok).toBe(false);
    if (!unknownKeyResult.ok) {
      expect(unknownKeyResult.diagnostics.some((entry) => entry.code === 'invalid_provenance' && entry.path === 'snapshot.provenance.reviewedAt')).toBe(true);
    }
    const bearerReviewer = buildSnapshot();
    bearerReviewer.provenance = { ...bearerReviewer.provenance, reviewedBy: ['sentropic-architect', 'Bearer abcdefgh12345678'] };
    reseal(bearerReviewer);
    const bearerResult = compileToolConfiguration({ snapshot: bearerReviewer, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(bearerResult.ok).toBe(false);
    if (!bearerResult.ok) {
      expect(bearerResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.provenance.reviewedBy[1]')).toBe(true);
    }
    const emailReviewer = buildSnapshot();
    emailReviewer.provenance = { ...emailReviewer.provenance, reviewedBy: ['ops@example.test'] };
    reseal(emailReviewer);
    const emailResult = compileToolConfiguration({ snapshot: emailReviewer, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(emailResult.ok).toBe(false);
    if (!emailResult.ok) {
      expect(emailResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.provenance.reviewedBy[0]')).toBe(true);
    }
  });

  it('rejects mistyped schema-keyword values instead of ignoring them', () => {
    const cases: Array<{ properties: Record<string, unknown>; values: Record<string, unknown> }> = [
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, mode: { type: 'string', maxLength: '10' } }, values: { maxResults: 20, mode: 'fast' } },
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: '100' } }, values: { maxResults: 20 } },
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, mode: { type: 'string', enum: 'fast' } }, values: { maxResults: 20, mode: 'fast' } },
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, tags: { type: 'array', items: [{ type: 'string' }] } }, values: { maxResults: 20, tags: ['a'] } },
    ];
    for (const { properties, values } of cases) {
      const keywordHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: { type: 'object', properties, required: ['maxResults'], additionalProperties: false } } };
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values };
      snapshot.handlersDigest = computeHandlersDigest(keywordHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: keywordHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
      }
    }
  });

  it('matches bearer abcdefgh12345678 schemes case-insensitively and spares maxTokens', () => {
    for (const value of ['Bearer abcdefgh12345678', 'Bearer abcdefgh12345678', 'Basic dXNlcjpwYXNz', 'mailto:a@example.test', 'ssh://host/x', 's3://bucket/key', 'vbscript:msgbox(1)']) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note: value, tags: ['paris'] } };
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content')).toBe(true);
      }
    }
    const contactSchema = {
      type: 'object',
      properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, contactEmail: { type: 'string' } },
      required: ['maxResults'],
      additionalProperties: false,
    };
    const contactHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: contactSchema } };
    const contactEmail = buildSnapshot();
    contactEmail.bindings[0] = { ...contactEmail.bindings[0], values: { maxResults: 20, contactEmail: 'x' } };
    contactEmail.handlersDigest = computeHandlersDigest(contactHandlers);
    reseal(contactEmail);
    const contactResult = compileToolConfiguration({ snapshot: contactEmail, manifest, handlers: contactHandlers, compatibilityDigest: consumerDigest });
    expect(contactResult.ok).toBe(false);
    if (!contactResult.ok) {
      expect(contactResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].values.contactEmail')).toBe(true);
    }
    const capped = buildSnapshot();
    capped.bindings[0] = { ...capped.bindings[0], values: { maxResults: 20, maxTokens: 512 } };
    const cappedHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: { type: 'object', properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, maxTokens: { type: 'integer', minimum: 1, maximum: 4096 } }, required: ['maxResults'], additionalProperties: false } } };
    capped.handlersDigest = computeHandlersDigest(cappedHandlers);
    reseal(capped);
    const cappedResult = compileToolConfiguration({ snapshot: capped, manifest, handlers: cappedHandlers, compatibilityDigest: consumerDigest });
    expect(cappedResult.ok).toBe(true);
  });

  it('rejects composed *Token keys while sparing maxTokens (R3-M1)', () => {
    const tokenSchema = {
      type: 'object',
      properties: {
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        authToken: { type: 'string' },
        githubToken: { type: 'string' },
        sessionToken: { type: 'string' },
        apiToken: { type: 'string' },
        maxTokens: { type: 'integer', minimum: 1, maximum: 4096 },
      },
      required: ['maxResults'],
      additionalProperties: false,
    };
    const tokenHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: tokenSchema } };
    for (const key of ['authToken', 'githubToken', 'sessionToken', 'apiToken']) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, [key]: 'x' } };
      snapshot.handlersDigest = computeHandlersDigest(tokenHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: tokenHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === `snapshot.bindings[0].values.${key}`)).toBe(true);
      }
    }
    const capped = buildSnapshot();
    capped.bindings[0] = { ...capped.bindings[0], values: { maxResults: 20, maxTokens: 512 } };
    const cappedHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: { type: 'object', properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, maxTokens: { type: 'integer', minimum: 1, maximum: 4096 } }, required: ['maxResults'], additionalProperties: false } } };
    capped.handlersDigest = computeHandlersDigest(cappedHandlers);
    reseal(capped);
    const cappedResult = compileToolConfiguration({ snapshot: capped, manifest, handlers: cappedHandlers, compatibilityDigest: consumerDigest });
    expect(cappedResult.ok).toBe(true);
  });

  it('bounds scheme and bearer abcdefgh12345678 to dangerous forms (R3-m1)', () => {
    const legitValues = ['Mode: fast', 'T09:30', 'urn:example', 'immo:cfg-12', 'role:owner', 'Basic plan', 'Select a city'];
    for (const note of legitValues) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note, tags: ['paris'] } };
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(true);
    }
    const dangerousValues = ['javascript:alert(1)', 'data:text/plain;base64,SGVsbG8=', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'node:fs', 'https://example.test/x', 'wss://example.test/x', 's3://bucket/key', 'ssh://host/x', 'mailto:a@example.test'];
    for (const note of dangerousValues) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note } };
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content')).toBe(true);
      }
    }
    for (const value of ['Bearer abcdefgh', 'Bearer ABCDEF1234567890', 'Basic dXNlcjpwYXNz', 'bearer abcdefghijkl', 'BASIC ABCDEFGH1234'] ) {
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, note: value, tags: ['paris'] } };
      snapshot.handlersDigest = computeHandlersDigest(noteHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: noteHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'forbidden_content')).toBe(true);
      }
    }
  });

  it('covers surviving R3-m2 controls with code and path', () => {
    const longBearer = 'Bearer abcdefgh12345678';
    const longJwt = 'eyJhbGciOiJIUzI1NiJ9.e30.signature12345678';
    const overlayScope = buildSnapshot();
    overlayScope.bindings[0] = { ...overlayScope.bindings[0], policy: { requiredScopes: ['synth:search', longBearer] } };
    reseal(overlayScope);
    const scopeResult = compileToolConfiguration({ snapshot: overlayScope, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(scopeResult.ok).toBe(false);
    if (!scopeResult.ok) {
      expect(scopeResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.requiredScopes[1]')).toBe(true);
    }
    const overlayClaim = buildSnapshot();
    overlayClaim.bindings[1] = { ...overlayClaim.bindings[1], policy: { requiredClaims: [longBearer] } };
    reseal(overlayClaim);
    const claimResult = compileToolConfiguration({ snapshot: overlayClaim, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(claimResult.ok).toBe(false);
    if (!claimResult.ok) {
      expect(claimResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[1].policy.requiredClaims[0]')).toBe(true);
    }
    const overlayAcr = snapshotFor(gatedManifest, gatedBindings({ freshness: { maxAgeSeconds: 100, stepUp: 'auth', acr: ['a1', longBearer], amr: ['m1'] } }));
    const acrResult = compileToolConfiguration({ snapshot: overlayAcr, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(acrResult.ok).toBe(false);
    if (!acrResult.ok) {
      expect(acrResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.freshness.acr[1]')).toBe(true);
    }
    const overlayAmr = snapshotFor(gatedManifest, gatedBindings({ freshness: { maxAgeSeconds: 100, stepUp: 'auth', acr: ['a1'], amr: ['m1', longBearer] } }));
    const amrResult = compileToolConfiguration({ snapshot: overlayAmr, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(amrResult.ok).toBe(false);
    if (!amrResult.ok) {
      expect(amrResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.freshness.amr[1]')).toBe(true);
    }
    const overlayMut = snapshotFor(gatedManifest, gatedBindings({ mutability: longBearer as unknown as ToolPolicyOverlay['mutability'] }));
    const mutResult = compileToolConfiguration({ snapshot: overlayMut, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(mutResult.ok).toBe(false);
    if (!mutResult.ok) {
      expect(mutResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.mutability')).toBe(true);
    }
    const overlayIdem = snapshotFor(gatedManifest, gatedBindings({ idempotency: { required: false, scope: longBearer } as unknown as ToolPolicyOverlay['idempotency'] }));
    const idemResult = compileToolConfiguration({ snapshot: overlayIdem, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(idemResult.ok).toBe(false);
    if (!idemResult.ok) {
      expect(idemResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.idempotency.scope')).toBe(true);
    }
    const overlayStep = snapshotFor(gatedManifest, gatedBindings({ freshness: { maxAgeSeconds: 100, stepUp: longBearer } as unknown as ToolPolicyOverlay['freshness'] }));
    const stepResult = compileToolConfiguration({ snapshot: overlayStep, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(stepResult.ok).toBe(false);
    if (!stepResult.ok) {
      expect(stepResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.bindings[0].policy.freshness.stepUp')).toBe(true);
    }
    const approvalJwt = buildSnapshot();
    approvalJwt.provenance = { ...approvalJwt.provenance, approvalRef: longJwt };
    reseal(approvalJwt);
    const approvalResult = compileToolConfiguration({ snapshot: approvalJwt, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(approvalResult.ok).toBe(false);
    if (!approvalResult.ok) {
      expect(approvalResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.provenance.approvalRef')).toBe(true);
    }
    const revisionBearer = buildSnapshot();
    revisionBearer.revision = longBearer;
    revisionBearer.provenance = { ...revisionBearer.provenance, revision: longBearer };
    reseal(revisionBearer);
    const revisionResult = compileToolConfiguration({ snapshot: revisionBearer, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(revisionResult.ok).toBe(false);
    if (!revisionResult.ok) {
      expect(revisionResult.diagnostics.some((entry) => entry.code === 'forbidden_content' && entry.path === 'snapshot.provenance.revision')).toBe(true);
    }
    const minLengthCases: Array<{ properties: Record<string, unknown>; values: Record<string, unknown> }> = [
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, mode: { type: 'string', minLength: '10' } }, values: { maxResults: 20, mode: 'fast' } },
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, tags: { type: 'array', minItems: '1', items: { type: 'string' } } }, values: { maxResults: 20, tags: ['a'] } },
      { properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 }, tags: { type: 'array', maxItems: '5', items: { type: 'string' } } }, values: { maxResults: 20, tags: ['a'] } },
    ];
    for (const { properties, values } of minLengthCases) {
      const keywordHandlers = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: { type: 'object', properties, required: ['maxResults'], additionalProperties: false } } };
      const snapshot = buildSnapshot();
      snapshot.bindings[0] = { ...snapshot.bindings[0], values };
      snapshot.handlersDigest = computeHandlersDigest(keywordHandlers);
      reseal(snapshot);
      const result = compileToolConfiguration({ snapshot, manifest, handlers: keywordHandlers, compatibilityDigest: consumerDigest });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
      }
    }
    const emptyConnector = buildSnapshot();
    emptyConnector.connectorId = '';
    const connectorResult = compileToolConfiguration({ snapshot: emptyConnector, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(connectorResult.ok).toBe(false);
    if (!connectorResult.ok) {
      expect(connectorResult.diagnostics.some((entry) => entry.code === 'invalid_identity' && entry.path === 'snapshot.connectorId')).toBe(true);
    }
    const emptyApproval = buildSnapshot();
    emptyApproval.provenance = { ...emptyApproval.provenance, approvalRef: '' };
    reseal(emptyApproval);
    const emptyApprovalResult = compileToolConfiguration({ snapshot: emptyApproval, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(emptyApprovalResult.ok).toBe(false);
    if (!emptyApprovalResult.ok) {
      expect(emptyApprovalResult.diagnostics.some((entry) => entry.code === 'invalid_provenance' && entry.path === 'snapshot.provenance.approvalRef')).toBe(true);
    }
    const unknownBinding = buildSnapshot();
    (unknownBinding.bindings[0] as Record<string, unknown>)['extra'] = 1;
    reseal(unknownBinding);
    const unknownBindingResult = compileToolConfiguration({ snapshot: unknownBinding, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(unknownBindingResult.ok).toBe(false);
    if (!unknownBindingResult.ok) {
      expect(unknownBindingResult.diagnostics.some((entry) => entry.code === 'malformed_snapshot' && entry.path === 'snapshot.bindings[0].extra')).toBe(true);
    }
    const unknownGates = snapshotFor(gatedManifest, gatedBindings({ gates: { requiresElicitation: true, unknownGate: true } as unknown as ToolPolicyOverlay['gates'] }));
    const unknownGatesResult = compileToolConfiguration({ snapshot: unknownGates, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(unknownGatesResult.ok).toBe(false);
    if (!unknownGatesResult.ok) {
      expect(unknownGatesResult.diagnostics.some((entry) => entry.code === 'policy_weakening' && entry.path === 'snapshot.bindings[0].policy')).toBe(true);
    }
  });

  it('requires qualified provider and platform versions', () => {
    const missing = buildSnapshot();
    delete (missing as Partial<ApprovedToolSnapshot>).providerVersion;
    delete (missing as Partial<ApprovedToolSnapshot>).platformVersion;
    const missingResult = compileToolConfiguration({ snapshot: missing, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.some((entry) => entry.code === 'invalid_identity' && entry.path === 'snapshot.providerVersion')).toBe(true);
      expect(missingResult.diagnostics.some((entry) => entry.code === 'invalid_identity' && entry.path === 'snapshot.platformVersion')).toBe(true);
    }
    const wrongPlatform = buildSnapshot();
    wrongPlatform.platformVersion = '9.9.9';
    reseal(wrongPlatform);
    const wrongResult = compileToolConfiguration({ snapshot: wrongPlatform, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(wrongResult.ok).toBe(false);
    if (!wrongResult.ok) {
      expect(wrongResult.diagnostics.some((entry) => entry.code === 'invalid_identity' && entry.path === 'snapshot.platformVersion')).toBe(true);
    }
  });

  it('never freezes overlay arrays and rejects explicit undefined gates', () => {
    const snapshot = buildSnapshot();
    const scopes = ['synth:search', 'synth:extra'];
    const claims: string[] = [];
    snapshot.bindings[0] = { ...snapshot.bindings[0], policy: { requiredScopes: scopes } };
    snapshot.bindings[1] = { ...snapshot.bindings[1], policy: { requiredClaims: claims } };
    reseal(snapshot);
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(scopes)).toBe(false);
    expect(Object.isFrozen(claims)).toBe(false);
    expect(Object.isFrozen(snapshot.bindings[0].policy)).toBe(false);
    if (!result.ok) return;
    scopes.push('synth:late');
    expect(result.config.tools.find((tool) => tool.toolName === 'synth_search')?.requiredScopes).toEqual(['synth:search', 'synth:extra']);
    // An explicit `undefined` gate value cannot be resealed (the canonical
    // encoder rejects it), so the mutation is applied after sealing: the
    // compiler must still refuse it with `policy_weakening`, not crash.
    const undefinedGates = snapshotFor(gatedManifest, gatedBindings({}));
    (undefinedGates.bindings[0] as ApprovedToolBinding).policy = { gates: { requiresHumanConfirmation: undefined } as unknown as ToolPolicyOverlay['gates'] };
    const undefinedResult = compileToolConfiguration({ snapshot: undefinedGates, manifest: gatedManifest, handlers, compatibilityDigest: gatedDigest });
    expect(undefinedResult.ok).toBe(false);
    if (!undefinedResult.ok) {
      expect(undefinedResult.diagnostics.some((entry) => entry.code === 'policy_weakening')).toBe(true);
    }
  });

  it('rejects every policy weakening on a strict baseline', () => {
    const digest = computeCompatibilityDigest(strictManifest);
    const run = (policy: ApprovedToolBinding['policy']) =>
      compileToolConfiguration({ snapshot: strictSnapshot(strictBindings(policy)), manifest: strictManifest, handlers: strictHandlers, compatibilityDigest: digest });
    expect(run(undefined).ok).toBe(true);
    const cases: Array<ToolPolicyOverlay> = [
      { idempotency: { required: false, scope: 'tenant' } },
      { idempotency: { required: true, scope: 'global' } },
      { mutability: 'read-only' },
      { mutatesExternalSystem: false },
      { requiredClaims: [] },
    ];
    for (const policy of cases) {
      const result = run(policy);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.some((entry) => entry.code === 'policy_weakening' && entry.path === 'snapshot.bindings[0].policy')).toBe(true);
      }
    }
  });

  it('rejects a resealed provenance manifestDigest divergence', () => {
    const snapshot = buildSnapshot();
    snapshot.provenance = { ...snapshot.provenance, manifestDigest: '0'.repeat(64) };
    reseal(snapshot);
    const result = compileToolConfiguration({ snapshot, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((entry) => entry.code === 'manifest_digest_mismatch' && entry.path === 'snapshot.provenance.manifestDigest')).toBe(true);
    }
  });

  it('rejects non-finite numbers on unbounded schemas', () => {
    const snapshot = strictSnapshot(strictBindings(undefined));
    snapshot.bindings[0] = { ...snapshot.bindings[0], values: { maxResults: 20, ratio: Number.POSITIVE_INFINITY } };
    const digest = computeCompatibilityDigest(strictManifest);
    const result = compileToolConfiguration({ snapshot, manifest: strictManifest, handlers: strictHandlers, compatibilityDigest: digest });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((entry) => entry.code === 'invalid_values')).toBe(true);
    }
  });

  it('rejects a handlersDigest that does not match the local table', () => {
    const snapshot = buildSnapshot();
    snapshot.provenance = { ...snapshot.provenance, payloadDigest: computePayloadDigest({ ...snapshot, handlersDigest: '1'.repeat(64) }) };
    const tampered = { ...snapshot, handlersDigest: '1'.repeat(64) };
    const result = compileToolConfiguration({ snapshot: tampered, manifest, handlers, compatibilityDigest: consumerDigest });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((entry) => entry.code === 'handlers_digest_mismatch' && entry.path === 'snapshot.handlersDigest')).toBe(true);
    }
    const widenedSchema = { type: 'object', properties: { maxResults: { type: 'integer', minimum: 1, maximum: 1000 }, mode: { type: 'string', enum: ['fast', 'deep'] } }, required: ['maxResults'], additionalProperties: false };
    const widened = { ...handlers, 'local-search': { handlerId: 'local-search', capabilityRef: 'synth_search', configSchema: widenedSchema } };
    const widenedResult = compileToolConfiguration({ snapshot: buildSnapshot(), manifest, handlers: widened, compatibilityDigest: consumerDigest });
    expect(widenedResult.ok).toBe(false);
    if (!widenedResult.ok) {
      expect(widenedResult.diagnostics.some((entry) => entry.code === 'handlers_digest_mismatch')).toBe(true);
    }
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
