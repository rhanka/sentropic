import {
  createBoundaryDomain,
  createClusterMeshRuntime,
  createLocalDeviceDomain,
  createRegistrationGate,
  createSingleNodeMembership,
  type BoundaryDomain,
  type ClusterNodeDescriptor,
  type DeviceDomain,
  type DevicePollOutcome,
  type IssuedDeviceCode,
  type DeviceApprovalResult,
  type LocalWorkstationDescriptor,
  type MembershipDomain,
  type ClusterMeshCutoverStore,
  type ClusterMeshRuntime,
  type ClusterMeshRuntimeStore,
  type McpSupervisorStore,
  type PtyActuatorPort,
  type SessionTargetStatePort,
  type WorkstationId,
} from '@sentropic/cluster-mesh';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';

import { env } from '../config/env';
import {
  approveDeviceCode,
  issueDeviceCode,
  pollDeviceCode,
} from './device-code-store';
import { resolveTenantAuthoritatively } from './tenancy/resolve-tenant';
import { PostgresClusterMeshCutoverStore } from './cluster-mesh/postgres-cutover-store';
import { PostgresClusterMeshRuntimeStore } from './cluster-mesh/postgres-runtime-store';

export interface ClusterMeshSessionControl {
  readonly runtime: ClusterMeshRuntime;
  readonly store: ClusterMeshRuntimeStore;
  readonly cutovers: ClusterMeshCutoverStore;
  readonly targets: SessionTargetStatePort;
  readonly ptyEvidence: 'adapter_available' | 'BR75-SG1_source_gap';
}

export interface ClusterMeshMcpControl {
  readonly runtime: ClusterMeshRuntime;
  readonly store: McpSupervisorStore & Pick<ClusterMeshRuntimeStore, 'saveGeneration'>;
  readonly cutovers: ClusterMeshCutoverStore;
  readonly supervisorRef: string;
  readonly serverId: string;
}

export interface ClusterMeshAppAdapter {
  readonly membership: MembershipDomain;
  readonly devices: DeviceDomain;
  readonly boundaries: BoundaryDomain;
  readonly sessionControl?: ClusterMeshSessionControl;
  readonly mcpControl?: ClusterMeshMcpControl;
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
  readonly sessionControl?: {
    readonly generationId: string;
    readonly context: VerifiedInvocationContextPort;
    readonly runtimeStore: ClusterMeshRuntimeStore;
    readonly mcpStore?: ClusterMeshMcpControl['store'];
    readonly cutovers: ClusterMeshCutoverStore;
    readonly pty: PtyActuatorPort;
    readonly targets: SessionTargetStatePort;
    readonly ptyEvidence: ClusterMeshSessionControl['ptyEvidence'];
  };
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
  const control = deps.sessionControl;
  const sessionControl = control ? {
    runtime: createClusterMeshRuntime({
      generationId: control.generationId,
      config: { capacity: { poolSize: 4 } },
      context: control.context,
      registration: createRegistrationGate({
        generationId: control.generationId,
        registrations: control.runtimeStore,
        pty: control.pty,
      }),
      receipts: control.runtimeStore,
    }),
    store: control.runtimeStore,
    cutovers: control.cutovers,
    targets: control.targets,
    ptyEvidence: control.ptyEvidence,
  } satisfies ClusterMeshSessionControl : undefined;
  const mcpControl = control?.mcpStore && sessionControl ? {
    runtime: sessionControl.runtime,
    store: control.mcpStore,
    cutovers: control.cutovers,
    supervisorRef: `mcp-supervisor:${control.generationId}`,
    serverId: `mcp-server:${control.generationId}`,
  } satisfies ClusterMeshMcpControl : undefined;

  return {
    devices,
    membership: createSingleNodeMembership({
      self: deps.self,
      boundaries,
      workstations: { async listAttached() { return [...attached.values()]; } },
    }),
    boundaries,
    sessionControl,
    mcpControl,
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

const runtimeStore = new PostgresClusterMeshRuntimeStore();
const unavailableH2aPtyPort: PtyActuatorPort = {
  kind: 'pty',
  async isAvailable() { return false; },
  async actuate() { throw new Error('BR75-SG1 h2a PTY adapter is unavailable'); },
};

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
  resolveTenant: resolveTenantAuthoritatively,
  sessionControl: {
    generationId: 'cluster-mesh-session-v1',
    context: {
      async verify() {
        throw new Error('verified session control evidence is unavailable');
      },
    },
    runtimeStore,
    mcpStore: runtimeStore,
    cutovers: new PostgresClusterMeshCutoverStore(),
    pty: unavailableH2aPtyPort,
    targets: { async inspect() { return 'unknown'; } },
    ptyEvidence: 'BR75-SG1_source_gap',
  },
});
