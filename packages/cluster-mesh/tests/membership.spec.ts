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
      boundaries: {
        async resolve(input) {
          return {
            tid: 'tenant-acme',
            workspace: 'ws:sha256:local',
            userId: input.userId,
            homeNodeId: self.nodeId,
          };
        },
      },
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

    await expect(membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' })).resolves.toEqual([
      self,
      expect.objectContaining({ deviceId: 'device:laptop', homeNodeId: self.nodeId }),
    ]);
  });

  it('should expose only workstations owned by the validated member', async () => {
    const membership = createSingleNodeMembership({
      self,
      boundaries: {
        async resolve(input) {
          return {
            tid: `tenant-for-${input.userId}`,
            workspace: 'ws:sha256:local',
            userId: input.userId,
            homeNodeId: self.nodeId,
          };
        },
      },
      workstations: {
        async listAttached() {
          return [
            { kind: 'workstation', deviceId: 'device:user-1', displayName: 'One', ownerSubject: 'user-1', state: 'attached' },
            { kind: 'workstation', deviceId: 'device:user-2', displayName: 'Two', ownerSubject: 'user-2', state: 'attached' },
          ];
        },
      },
    });

    const directory = await membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' });

    expect(directory).toEqual([
      self,
      expect.objectContaining({ deviceId: 'device:user-1', ownerSubject: 'user-1' }),
    ]);
  });

  it('should fail closed when inter-server discovery or revocation is requested', async () => {
    const membership = createSingleNodeMembership({
      self,
      boundaries: {
        async resolve() { throw new Error('not used'); },
      },
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
