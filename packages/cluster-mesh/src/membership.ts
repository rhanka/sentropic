import { CapabilityGatedError } from './errors.js';
import type { BoundaryDomain, MembershipLookup } from './boundaries.js';

export type ClusterNodeId = `node:${string}`;
export type WorkstationId = `device:${string}`;

export interface ClusterNodeDescriptor {
  readonly kind: 'server';
  readonly nodeId: ClusterNodeId;
  readonly issuer: string;
  readonly endpoint: string;
  readonly state: 'active';
}

export interface LocalWorkstationDescriptor {
  readonly kind: 'workstation';
  readonly deviceId: WorkstationId;
  readonly displayName: string;
  readonly ownerSubject: string;
  readonly state: 'attached';
}

export type ClusterDirectoryEntry =
  | ClusterNodeDescriptor
  | (LocalWorkstationDescriptor & { readonly homeNodeId: ClusterNodeId });

export interface LocalWorkstationDirectoryPort {
  listAttached(): Promise<readonly LocalWorkstationDescriptor[]>;
}

/** Future F-C discovery and member-revocation seam. It has no live v1 binding. */
export interface InterServerDirectoryPort {
  discover(): Promise<readonly ClusterNodeDescriptor[]>;
  revoke(nodeId: ClusterNodeId): Promise<void>;
}

export interface MembershipDomain {
  readonly self: ClusterNodeDescriptor;
  readonly interServer: InterServerDirectoryPort;
  listDirectory(input: MembershipLookup): Promise<readonly ClusterDirectoryEntry[]>;
}

export function createGatedInterServerDirectory(): InterServerDirectoryPort {
  return {
    async discover() {
      throw new CapabilityGatedError('inter_server_discovery');
    },
    async revoke() {
      throw new CapabilityGatedError('inter_server_revocation');
    },
  };
}

/** Real v1 directory: exactly this server followed by its currently attached local devices. */
export function createSingleNodeMembership(input: {
  self: ClusterNodeDescriptor;
  boundaries: Pick<BoundaryDomain, 'resolve'>;
  workstations: LocalWorkstationDirectoryPort;
}): MembershipDomain {
  const interServer = createGatedInterServerDirectory();
  return {
    self: input.self,
    interServer,
    async listDirectory(lookup) {
      const residence = await input.boundaries.resolve(lookup);
      const devices = await input.workstations.listAttached();
      return [
        input.self,
        ...devices
          .filter((device) => device.ownerSubject === residence.userId)
          .map((device) => ({ ...device, homeNodeId: input.self.nodeId })),
      ];
    },
  };
}
