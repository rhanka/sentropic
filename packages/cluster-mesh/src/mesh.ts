import { createBoundaryDomain, type BoundaryDomain, type ValidatedMembershipPort } from './boundaries.js';
import { createLocalDeviceDomain, type DeviceDomain, type LocalDeviceAttachmentPort } from './device.js';
import { createGatedMemoryReplication, type MemoryReplicationPort } from './memory.js';
import {
  createSingleNodeMembership,
  type ClusterNodeDescriptor,
  type LocalWorkstationDirectoryPort,
  type MembershipDomain,
} from './membership.js';
import { createH2aNhiLifecycle, type CommandRunnerPort, type NhiLifecyclePort } from './nhi.js';
import { createLocalProjectionDomain, type LocalProjectionPort, type ProjectionDomain } from './projection.js';
import { createGatedTrustDomain, type TrustDomain } from './trust.js';

export interface WrapDomain {
  readonly projections: ProjectionDomain;
  readonly nhi: NhiLifecyclePort;
  readonly memoryReplication: MemoryReplicationPort;
}

export interface ClusterMesh {
  readonly membership: MembershipDomain;
  readonly trust: TrustDomain;
  readonly wrap: WrapDomain;
  readonly devices: DeviceDomain;
  readonly boundaries: BoundaryDomain;
  readonly capabilities: {
    readonly mode: 'single-node';
    readonly localDevices: 'available';
    readonly localProjection: 'available';
    readonly interServerDirectory: 'gated';
    readonly tokenExchange: 'gated';
    readonly memoryReplication: 'gated';
  };
}

/** @deprecated Removal locator: delete after its remaining callers cut over in Lots 4–32. */
export function createDegenerateClusterMesh(input: {
  readonly self: ClusterNodeDescriptor;
  readonly workstations: LocalWorkstationDirectoryPort;
  readonly memberships: ValidatedMembershipPort;
  readonly projections: LocalProjectionPort;
  readonly nhiRunner: CommandRunnerPort;
  readonly devices: LocalDeviceAttachmentPort;
}): ClusterMesh {
  const boundaries = createBoundaryDomain({
    homeNodeId: input.self.nodeId,
    memberships: input.memberships,
  });
  return {
    membership: createSingleNodeMembership({ ...input, boundaries }),
    trust: createGatedTrustDomain(),
    wrap: {
      projections: createLocalProjectionDomain({ homeNodeId: input.self.nodeId, local: input.projections }),
      nhi: createH2aNhiLifecycle(input.nhiRunner),
      memoryReplication: createGatedMemoryReplication(),
    },
    devices: createLocalDeviceDomain(input.devices),
    boundaries,
    capabilities: {
      mode: 'single-node',
      localDevices: 'available',
      localProjection: 'available',
      interServerDirectory: 'gated',
      tokenExchange: 'gated',
      memoryReplication: 'gated',
    },
  };
}
