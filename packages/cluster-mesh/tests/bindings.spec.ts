import { describe, expect, it, vi } from 'vitest';
import { createDegenerateClusterMesh, type NhiLifecyclePort } from '../src/index.js';

function bindings() {
  return {
    self: { kind: 'server' as const, nodeId: 'local', issuer: 'issuer', endpoint: 'https://local.test', state: 'active' as const },
    workstations: { async listAttached() { return []; } },
    memberships: { async resolveApproved() { return null; } },
    projections: {
      availability: 'available' as 'available' | 'gated',
      create: vi.fn(), verify: vi.fn(), resolve: vi.fn(),
    },
    devices: {
      availability: 'available' as 'available' | 'gated',
      issueDeviceCode: vi.fn(), pollDeviceCode: vi.fn(), approveDeviceCode: vi.fn(),
    },
    nhiRunner: { run: vi.fn() },
  };
}

describe('runtime bindings', () => {
  it('should expose and enforce mixed projection support before delegation', async () => {
    const input = bindings();
    expect(createDegenerateClusterMesh(input).capabilities.localProjectionKinds)
      .toEqual(['human_identity', 'agent_identity', 'memory_snapshot']);
    const projections = { ...input.projections, supportedKinds: ['human_identity', 'agent_identity'] as const };
    const mesh = createDegenerateClusterMesh({ ...input, projections });
    expect(mesh.capabilities.localProjectionKinds).toEqual(['human_identity', 'agent_identity']);
    const ref = { kind: 'agent_identity' as const, reference: 'agent', homeNodeId: 'local', issuer: 'issuer', keyId: 'key', signature: 'sig' };
    projections.create.mockResolvedValue(ref);
    projections.verify.mockResolvedValue(true);
    projections.resolve.mockResolvedValue('identity');
    await expect(mesh.wrap.projections.project(ref.kind, 'agent')).resolves.toBe(ref);
    await expect(mesh.wrap.projections.resolve(ref)).resolves.toBe('identity');
    await expect(mesh.wrap.projections.project('memory_snapshot', 'memory'))
      .rejects.toMatchObject({ code: 'capability_gated', capability: 'local_projection' });
    await expect(mesh.wrap.projections.resolve({ ...ref, kind: 'memory_snapshot' }))
      .rejects.toMatchObject({ code: 'capability_gated', capability: 'local_projection' });
    expect(projections.create).toHaveBeenCalledOnce();
    expect(projections.verify).toHaveBeenCalledTimes(2);
    expect(projections.resolve).toHaveBeenCalledOnce();
    projections.availability = 'gated';
    expect(mesh.capabilities.localProjectionKinds).toEqual([]);
    const empty = createDegenerateClusterMesh({ ...input, projections: { ...input.projections, supportedKinds: [] } });
    expect(empty.capabilities.localProjectionKinds).toEqual([]);
    await expect(empty.wrap.projections.project('human_identity', 'human'))
      .rejects.toMatchObject({ code: 'capability_gated', capability: 'local_projection' });
  });

  it('should report current binding availability and reject gated local operations', async () => {
    const input = bindings();
    const mesh = createDegenerateClusterMesh(input);
    expect(mesh.capabilities.localDevices).toBe('available');
    expect(mesh.capabilities.localProjection).toBe('available');
    input.devices.availability = 'gated';
    input.projections.availability = 'gated';
    expect(mesh.capabilities.localDevices).toBe('gated');
    expect(mesh.capabilities.localProjection).toBe('gated');
    expect(() => mesh.devices.issueDeviceCode()).toThrow('local_devices');
    expect(() => mesh.devices.pollDeviceCode('code')).toThrow('local_devices');
    expect(() => mesh.devices.approveDeviceCode('code', 'user', 'role')).toThrow('local_devices');
    await expect(mesh.wrap.projections.project('agent_identity', 'agent')).rejects.toThrow('local_projection');
    await expect(mesh.wrap.projections.resolve({} as never)).rejects.toThrow('local_projection');
    expect(input.projections.create).not.toHaveBeenCalled();
    expect(input.projections.verify).not.toHaveBeenCalled();
    expect(input.devices.issueDeviceCode).not.toHaveBeenCalled();
    input.devices.availability = 'available';
    mesh.devices.issueDeviceCode();
    expect(input.devices.issueDeviceCode).toHaveBeenCalledOnce();
  });

  it('should use an injected lifecycle without invoking the runner, including failures', async () => {
    const input = bindings();
    const nhi: NhiLifecyclePort = {
      attest: vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'denied' }),
      offboard: vi.fn().mockRejectedValue(new Error('offline')),
      exportBundle: vi.fn(),
    };
    const mesh = createDegenerateClusterMesh({ ...input, nhi });
    expect(mesh.wrap.nhi).toBe(nhi);
    await expect(mesh.wrap.nhi.attest({ instance: 'agent', privateKey: 'key' })).resolves.toMatchObject({ exitCode: 1 });
    await expect(mesh.wrap.nhi.offboard({ instance: 'agent' })).rejects.toThrow('offline');
    expect(input.nhiRunner.run).not.toHaveBeenCalled();
    expect(createDegenerateClusterMesh({ ...input, nhiRunner: undefined, nhi }).wrap.nhi).toBe(nhi);
  });

  it('should reject construction without a lifecycle or runner', () => {
    expect(() => createDegenerateClusterMesh({ ...bindings(), nhiRunner: undefined })).toThrow('nhi or nhiRunner');
  });
});
