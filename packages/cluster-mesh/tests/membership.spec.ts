import { describe, expect, it } from 'vitest';
import {
  CapabilityGatedError,
  createSingleNodeMembership,
  type ClusterNodeDescriptor,
} from '../src/index.js';

const self: ClusterNodeDescriptor = {
  kind: 'server',
  nodeId: 'node:sentropic-local',
  issuer: 'https://auth.example.test',
  endpoint: 'https://sentropic.example.test',
  state: 'active',
};

describe('single-node membership', () => {
  it('should list self and attached local workstations when the directory is read', async () => {
    const membership = createSingleNodeMembership({
      self,
      workstations: {
        async listAttached() {
          return [{
            kind: 'workstation',
            deviceId: 'device:laptop',
            displayName: 'Laptop',
            ownerSubject: 'user-1',
            state: 'attached',
          }];
        },
      },
    });

    await expect(membership.listDirectory()).resolves.toEqual([
      self,
      expect.objectContaining({ deviceId: 'device:laptop', homeNodeId: self.nodeId }),
    ]);
  });

  it('should fail closed when inter-server discovery or revocation is requested', async () => {
    const membership = createSingleNodeMembership({
      self,
      workstations: { async listAttached() { return []; } },
    });

    await expect(membership.interServer.discover()).rejects.toMatchObject({
      capability: 'inter_server_discovery',
    } satisfies Partial<CapabilityGatedError>);
    await expect(membership.interServer.revoke('node:remote')).rejects.toMatchObject({
      capability: 'inter_server_revocation',
    } satisfies Partial<CapabilityGatedError>);
  });
});
