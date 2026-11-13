import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionNode, RunscRuntimeAdapter } from '../src/index.js';
import { requireNetworkPolicy } from '../src/network-policy.js';

afterEach(() => vi.unstubAllEnvs());
const input = { tenantId: 'immo', sandboxUid: 'network', mounts: [], overlayUpper: '/tmp/upper',
  overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 };

describe('AMD-28 admission', () => {
  it.each([false, true])('should admit the real node-22 live wire profile with the derived session slot (standby=%s)', async warmStandby => {
    const node = createExecutionNode();
    const launch = vi.spyOn(node.adapter, 'runSandbox');
    const ownership = { tenantId: 'immo', poolOwned: false, workspaceId: 'w', principalId: 'p', attemptId: 'a', purpose: 'live', generation: 1, custodyEpoch: 1 };
    const compatibility = { tenantId: 'immo', profile: 'node-22' };
    const box = await node.daemon.createSandbox({ commandId: 'real-profile', warmStandby, ownership, compatibility,
      spec: { tenantId: 'immo', profile: 'node-22', network: 'ports', baseMounts: [], quotaMiB: 16, quotaInodes: 1024,
        command: ['/bin/sleep', '60'], devScope: { kind: 'ui', writable: ['ui/**'], refused: [], source: { repo: 'r', path: 'p', commit: 'c' } } } } as never);
    if (warmStandby) await node.daemon.claimSandbox({ commandId: 'claim', standbyId: box.id,
      claim: { tenantId: 'immo', ownership, compatibility }, devScope: box.devScope } as never);
    else await node.daemon.promoteToRunning('immo', box.id, { commandId: 'start', devScope: box.devScope } as never);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ profile: 'node-22', slot: warmStandby ? 'standby' : 'live', network: 'ports' }));
    expect(new RunscRuntimeAdapter().runscArgs({ ...input, network: 'ports', profile: 'node-22', slot: 'live' })).toContain('--network=sandbox');
    expect(() => new RunscRuntimeAdapter().runscArgs({ ...input, network: 'ports', profile: 'artifact-build', slot: 'live' })).toThrow();
  });
  it.each(['artifact-build', 'prebundle', 'cold-materialize', 'browser-harness', 'other', undefined])('should refuse ports for profile %s', profile => {
    expect(() => requireNetworkPolicy('ports', profile)).toThrow('live or standby');
  });
  it.each(['', 'a'.repeat(64), undefined])('should refuse ports when the qualified digest is missing or differs (%s)', digest => {
    vi.stubEnv('EXECUTION_NODE_PORTS_RUNSC_SHA256', digest);
    expect(() => requireNetworkPolicy('ports', 'live')).toThrow(expect.objectContaining({ code: 'ports_disabled', status: 409 }));
    expect(() => requireNetworkPolicy('none', 'artifact-build')).not.toThrow();
  });
  it.each(['host', 'sandbox', '--host-uds', 'all', '', null, 1])('should reject forbidden network %s at spec and adapter boundaries', async network => {
    const node = createExecutionNode();
    await expect(node.daemon.createSandbox({ spec: { network } } as never)).rejects.toThrow('network must be none or ports');
    const adapter = new RunscRuntimeAdapter();
    expect(() => adapter.runscArgs({ ...input, network } as never)).toThrow('network must be none or ports');
    await expect(adapter.runSandbox({ ...input, network } as never)).rejects.toThrow('network must be none or ports');
  });
  it.each([undefined, 'false', 'true', '1'])('should require explicit operator enablement (%s)', async enabled => {
    vi.stubEnv('EXECUTION_NODE_PORTS_ENABLED', enabled);
    if (enabled === 'true') {
      expect(() => requireNetworkPolicy('ports', 'live')).not.toThrow();
      expect(new RunscRuntimeAdapter().runscArgs({ ...input, network: 'ports', profile: 'live' })).toContain('--network=sandbox');
    } else {
      expect(() => requireNetworkPolicy('ports')).toThrow(expect.objectContaining({ code: 'ports_disabled', status: 409 }));
      await expect(createExecutionNode().daemon.createSandbox({ spec: { network: 'ports' } } as never))
        .rejects.toMatchObject({ code: 'ports_disabled', status: 409 });
      await expect(new RunscRuntimeAdapter().runSandbox({ ...input, network: 'ports' })).rejects.toMatchObject({ status: 409 });
    }
    expect(() => requireNetworkPolicy('none')).not.toThrow();
  });
});
