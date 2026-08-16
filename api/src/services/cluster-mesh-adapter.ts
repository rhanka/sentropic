import {
  createBoundaryDomain,
  createLocalDeviceDomain,
  createSingleNodeMembership,
  type BoundaryDomain,
  type ClusterNodeDescriptor,
  type DeviceDomain,
  type DevicePollOutcome,
  type IssuedDeviceCode,
  type DeviceApprovalResult,
  type LocalWorkstationDescriptor,
  type MembershipDomain,
  type WorkstationId,
} from '@sentropic/cluster-mesh';

import { env } from '../config/env';
import {
  approveDeviceCode,
  issueDeviceCode,
  pollDeviceCode,
} from './device-code-store';
import { resolveTenant } from './tenancy/resolve-tenant';

export interface ClusterMeshAppAdapter {
  readonly membership: MembershipDomain;
  readonly devices: DeviceDomain;
  readonly boundaries: BoundaryDomain;
  completeDeviceAttachment(outcome: Extract<DevicePollOutcome, { status: 'approved' }>): void;
}

export interface ClusterMeshAppDependencies {
  readonly self: ClusterNodeDescriptor;
  issueDeviceCode(deviceName?: string | null): IssuedDeviceCode;
  pollDeviceCode(deviceCode: string): DevicePollOutcome;
  approveDeviceCode(
    userCode: string,
    userId: string,
    role: string,
    deviceName?: string | null,
  ): DeviceApprovalResult;
  resolveTenant(input: {
    workspaceId: string;
    userId: string;
  }): Promise<{ tenantId: string } | { error: 'unknown' | 'ambiguous_tenant' }>;
  createWorkstationId?(): WorkstationId;
}

export function createClusterMeshAppAdapter(deps: ClusterMeshAppDependencies): ClusterMeshAppAdapter {
  const attached = new Map<string, LocalWorkstationDescriptor>();
  const devices = createLocalDeviceDomain({
    issueDeviceCode: deps.issueDeviceCode,
    approveDeviceCode: deps.approveDeviceCode,
    pollDeviceCode: deps.pollDeviceCode,
  });
  const boundaries = createBoundaryDomain({
    homeNodeId: deps.self.nodeId,
    memberships: {
      async resolveApproved(input) {
        const result = await deps.resolveTenant(input);
        if ('error' in result) return null;
        return { tenantId: result.tenantId, userId: input.userId, status: 'approved' };
      },
    },
  });

  return {
    devices,
    membership: createSingleNodeMembership({
      self: deps.self,
      boundaries,
      workstations: { async listAttached() { return [...attached.values()]; } },
    }),
    boundaries,
    completeDeviceAttachment(outcome) {
      const key = `${outcome.userId}\0${outcome.deviceName}`;
      if (attached.has(key)) return;
      attached.set(key, {
        kind: 'workstation',
        deviceId: deps.createWorkstationId?.() ?? `device:${crypto.randomUUID()}`,
        displayName: outcome.deviceName,
        ownerSubject: outcome.userId,
        state: 'attached',
      });
    },
  };
}

const localEndpoint = (process.env.API_BASE_URL || env.OAUTH_ISSUER_URL || `http://localhost:${env.PORT}`)
  .replace(/\/$/, '');

export const clusterMeshAdapter = createClusterMeshAppAdapter({
  self: {
    kind: 'server',
    nodeId: 'node:sentropic-local',
    issuer: env.OAUTH_ISSUER_URL?.replace(/\/$/, '') || localEndpoint,
    endpoint: localEndpoint,
    state: 'active',
  },
  issueDeviceCode,
  pollDeviceCode,
  approveDeviceCode,
  resolveTenant,
});
