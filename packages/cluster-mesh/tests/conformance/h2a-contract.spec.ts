import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// Cross-repo runners replace only this import with the pinned package under test.
import * as api from '../../src/index.js';

const f = JSON.parse(readFileSync(new URL('./h2a-contract.json', import.meta.url), 'utf8'));
function bindings() {
  return {
    self: f.self, workstations: { listAttached: async () => [] },
    memberships: { resolveApproved: vi.fn(async () => f.membership) },
    projections: { create: vi.fn(async () => f.reference), verify: vi.fn(async () => true), resolve: vi.fn(async () => f.projectionCases[0].expected) },
    devices: {
      issueDeviceCode: vi.fn(() => ({ ...f.device, expiresAt: new Date(f.device.expiresAt) })),
      pollDeviceCode: vi.fn(() => f.poll), approveDeviceCode: vi.fn(() => f.approval),
    },
    nhiRunner: { run: vi.fn(async () => f.commandResult) },
  };
}

describe('h2a public contract: N/N-1 baseline', () => {
  it('should preserve capabilities, membership boundaries and device results', async () => {
    const input = bindings();
    const mesh = api.createDegenerateClusterMesh(input);
    expect(mesh.capabilities).toMatchObject(f.capabilities);
    await expect(mesh.boundaries.resolve(f.lookup)).resolves.toEqual(f.residence);
    await expect(mesh.membership.listDirectory(f.lookup)).resolves.toEqual([f.self]);
    input.memberships.resolveApproved.mockResolvedValue(null);
    await expect(mesh.boundaries.resolve(f.lookup)).rejects.toMatchObject({ code: 'tenant_membership_required' });
    expect(JSON.parse(JSON.stringify(mesh.devices.issueDeviceCode('Laptop')))).toEqual(f.device);
    expect(mesh.devices.pollDeviceCode('d')).toEqual(f.poll);
    expect(mesh.devices.approveDeviceCode('u', 'user:1', 'OWNER')).toEqual(f.approval);
    expect(input.devices.approveDeviceCode).toHaveBeenCalledWith('u', 'user:1', 'OWNER', undefined);
  });

  it.each(f.projectionCases)('should preserve projection outcome: $name', async c => {
    const input = bindings();
    input.projections.verify.mockResolvedValue(c.verified);
    const domain = api.createDegenerateClusterMesh(input).wrap.projections;
    const result = domain.resolve({ ...f.reference, ...c.patch });
    if (c.error) {
      await expect(result).rejects.toMatchObject(c.error);
      expect(input.projections.resolve).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toEqual(c.expected);
      await expect(domain.project(f.reference.kind, 'agent:1')).resolves.toEqual(f.reference);
    }
  });

  it.each(f.nhi)('should preserve NHI arguments and failure result: $method', async c => {
    const input = bindings();
    const lifecycle = api.createH2aNhiLifecycle(input.nhiRunner);
    await expect(lifecycle[c.method as keyof typeof lifecycle](c.input)).resolves.toEqual(f.commandResult);
    expect(input.nhiRunner.run).toHaveBeenCalledWith('h2a', c.args);
  });

  it('should keep federal operations gated', async () => {
    const mesh = api.createDegenerateClusterMesh(bindings());
    for (const [operation, capability] of [
      [() => mesh.membership.interServer.discover(), 'inter_server_discovery'],
      [() => mesh.membership.interServer.revoke('node:remote'), 'inter_server_revocation'],
      [() => mesh.trust.tokenExchange.exchange({ grantType: api.RFC8693_GRANT_TYPE, subjectToken: 'token', subjectTokenType: api.ACCESS_TOKEN_TYPE, audience: 'remote', scope: [] }), 'rfc8693_token_exchange'],
      [() => mesh.wrap.memoryReplication.replicate(f.reference), 'memory_replication'],
      [() => mesh.wrap.memoryReplication.purge(f.reference), 'memory_replication'],
    ] as const) await expect(operation()).rejects.toMatchObject({ code: 'capability_gated', capability });
  });
});

describe('h2a public contract: since 0.11', () => {
  it('should expose mixed support, canonical timestamps and legacy denial gating', () => {
    const input = bindings();
    const mesh = api.createDegenerateClusterMesh({ ...input, projections: { ...input.projections, supportedKinds: f.since011.supportedKinds } });
    expect(mesh.capabilities.localProjectionKinds).toEqual(f.since011.supportedKinds);
    expect(new TextDecoder().decode(api.canonicalProjectionReferenceBytes({ ...f.reference, ...f.since011.timestamps })))
      .toBe(f.since011.canonical);
    expect(() => mesh.devices.denyDeviceCode!('u')).toThrowError(expect.objectContaining(f.since011.denialError));
  });
});
