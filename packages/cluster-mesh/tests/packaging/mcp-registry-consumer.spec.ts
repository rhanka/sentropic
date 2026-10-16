import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson } from './helpers.js';

// Packed registry consumer (Lot 7): a clean third-party tree installs the
// packed candidate plus the packed platform sibling and drives the mesh
// facade over the real kernel — register/select/compile/resolve plus one
// canonical entry digest. Runs only on the prepared fixtures (CI); skipped
// otherwise. Optional peers stay absent.
const PROBE = `
  import { createMcpRegistry } from '@sentropic/cluster-mesh/mcp/registry';
  import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
  import { canonicalizeRegistryRequest } from '@sentropic/mcp-platform/registry/entry';
  const modules = { load: async (id) => {
    if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
    throw new Error('unexpected load ' + id);
  } };
  const manifest = { appId: 'probe-app', providerId: 'immo', version: '0.0.0',
    displayName: 'Probe', resources: [], prompts: [],
    tools: [{ kind: 'tool', name: 'immo_search', description: 'S.', requiredScopes: ['p:u'],
      requiredClaims: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      redactionClass: 'low', mutability: 'read-only', mutatesExternalSystem: false,
      idempotency: { required: false },
      gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false } }],
    authz: { requiredClaims: [], scopes: ['p:u'], tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] }, durability: {} };
  const limit = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
    required: ['limit'], additionalProperties: false };
  const registry = createMcpRegistry({ modules });
  registry.register({ manifest, adapter: { appId: 'probe-app', connectorId: 'probe' },
    parameterSchema: { properties: {}, required: [] },
    handlers: { 'immo_search-handler': { handlerId: 'immo_search-handler', capabilityRef: 'immo_search', configSchema: limit } },
    requiredPorts: [], provenance: { approvalRef: 'a', revision: 'r', manifestDigest: 'm', reviewedBy: ['o'] },
    toolValues: { immo_search: { handlerId: 'immo_search-handler', values: { limit: 20 } } } });
  registry.select(['immo']);
  const compiled = await registry.compile({ bindings: {},
    compatibility: { immo: { manifestDigest: computeManifestDigest(manifest) } } });
  if (!compiled.ok) { console.log(JSON.stringify({ ok: false })); process.exit(0); }
  const hit = compiled.registry.resolveTool('immo_search');
  const canonical = canonicalizeRegistryRequest({ tool: 'immo_search', args: { limit: 20 } });
  console.log(JSON.stringify({ ok: true, provider: hit?.providerId, digest: canonical.digest }));
`;

describe.skipIf(!enabled)('packed registry consumer', () => {
  it('drives the packed facade over the packed kernel', () => {
    const out = nodeJson<{ ok: boolean; provider?: string; digest?: string }>(
      fixtureDir('mcp-consumer'),
      PROBE,
    );
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('immo');
    expect(out.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
