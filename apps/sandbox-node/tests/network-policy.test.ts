import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionNode, RunscRuntimeAdapter } from '../src/index.js';
import { requireNetworkPolicy } from '../src/network-policy.js';

afterEach(() => vi.unstubAllEnvs());
const input = { tenantId: 'immo', sandboxUid: 'network', mounts: [], overlayUpper: '/tmp/upper',
  overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 };

describe('AMD-28 admission', () => {
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
