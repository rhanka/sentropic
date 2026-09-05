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
  type ClusterMeshRegistration,
  type ClusterMeshRuntime,
  type ClusterMeshRuntimeStore,
  type McpSupervisorStore,
  type PtyActuatorPort,
  type SessionTargetStatePort,
  type WorkstationId,
} from '@sentropic/cluster-mesh';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import { timingSafeEqual } from 'node:crypto';

import { env } from '../config/env';
import {
  approveDeviceCode,
  issueDeviceCode,
  pollDeviceCode,
} from './device-code-store';
import { resolveTenantAuthoritatively } from './tenancy/resolve-tenant';
import { PostgresClusterMeshCutoverStore } from './cluster-mesh/postgres-cutover-store';
import { PostgresClusterMeshRuntimeStore } from './cluster-mesh/postgres-runtime-store';
import { createClusterMeshInvocationVerifier } from './cluster-mesh/invocation-verifier';
import { createLiveH2aPorts, LIVE_H2A_ACTUATOR_REF } from './h2a-native-terminal';

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
  ensureDeviceAttachmentAvailable(): Promise<void>;
  completeDeviceAttachment(
    outcome: Extract<DevicePollOutcome, { status: 'approved' }>,
    session: { readonly sessionId: string; readonly expiresAt: Date },
  ): Promise<void>;
}

export interface ClusterMeshWorkstationAdmissionStore {
  admitWorkstation(input: {
    readonly generationId: string; readonly sessionId: string; readonly ownerSubject: string; readonly displayName: string; readonly expiresAt: string;
  }): Promise<void>;
  listAdmittedWorkstations(generationId: string): Promise<readonly LocalWorkstationDescriptor[]>;
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
  readonly sessionAdmission?: {
    readonly generationId: string;
    readonly store: ClusterMeshWorkstationAdmissionStore;
    ensureGeneration(): Promise<void>;
  };
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
      workstations: { async listAttached() {
        if (!deps.sessionAdmission) return [];
        return deps.sessionAdmission.store.listAdmittedWorkstations(deps.sessionAdmission.generationId);
      } },
    }),
    boundaries,
    sessionControl,
    mcpControl,
    async ensureDeviceAttachmentAvailable() {
      if (!deps.sessionAdmission) throw new Error('cluster mesh session admission is unavailable');
      await deps.sessionAdmission.ensureGeneration();
    },
    async completeDeviceAttachment(outcome, session) {
      if (!deps.sessionAdmission) throw new Error('cluster mesh session admission is unavailable');
      await deps.sessionAdmission.ensureGeneration();
      await deps.sessionAdmission.store.admitWorkstation({
        generationId: deps.sessionAdmission.generationId,
        sessionId: session.sessionId,
        ownerSubject: outcome.userId,
        displayName: outcome.deviceName,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  };
}

const localEndpoint = (process.env.API_BASE_URL || env.OAUTH_ISSUER_URL || `http://localhost:${env.PORT}`)
  .replace(/\/$/, '');

const runtimeStore = new PostgresClusterMeshRuntimeStore();
const sessionGenerationId = 'cluster-mesh-session-v1';
const meshEvidenceAudience = process.env.CLUSTER_MESH_EVIDENCE_AUDIENCE
  ?? `${localEndpoint}/api/v1/auth/session/control`;
const meshInvocationVerifier = createClusterMeshInvocationVerifier({
  publicKeysJson: process.env.CLUSTER_MESH_ED25519_PUBLIC_KEYS_JSON,
  audiences: [meshEvidenceAudience, ...(process.env.CLUSTER_MESH_LEGACY_AUDIENCES ?? '').split(',').map((value) => value.trim())],
  isReplayed: (invocationId) => runtimeStore.hasCommand(invocationId),
});
const ensureSessionGeneration = async () => {
  await runtimeStore.ensureGeneration({
    generationId: sessionGenerationId,
    status: 'active',
    supervisorRef: `mcp-supervisor:${sessionGenerationId}`,
    supervisorLeaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    maxConcurrent: 12,
    poolSize: 4,
  });
  if (!await runtimeStore.isGenerationAvailable(sessionGenerationId)) {
    throw new Error('cluster_mesh_generation_unavailable');
  }
};
const unavailableH2aPtyPort: PtyActuatorPort = {
  kind: 'pty',
  async isAvailable() { return false; },
  async actuate() { throw new Error('BR75-SG1 h2a PTY adapter is unavailable'); },
};

type QualificationEnvironment = Readonly<Record<string, string | undefined>>;
export function resolveLiveQualificationConfig(source: QualificationEnvironment) {
  if (source.NODE_ENV === 'production' && source.CLUSTER_MESH_A1_EVIDENCE) {
    throw new Error('shared-secret cluster mesh qualification is forbidden in production');
  }
  if (source.CLUSTER_MESH_A1_QUALIFICATION !== '1') return undefined;
  return source.H2A_NATIVE_SOCKET && source.H2A_ROOT
    && source.CLUSTER_MESH_A1_EVIDENCE && source.CLUSTER_MESH_A1_TARGET_REGISTRATION
    ? {
        socketPath: source.H2A_NATIVE_SOCKET,
        root: source.H2A_ROOT,
        evidence: source.CLUSTER_MESH_A1_EVIDENCE,
        registrationId: source.CLUSTER_MESH_A1_TARGET_REGISTRATION,
      }
    : undefined;
}
const liveConfig = resolveLiveQualificationConfig(process.env);
const livePorts = liveConfig ? createLiveH2aPorts(liveConfig) : undefined;
const liveExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const liveRegistration: ClusterMeshRegistration | undefined = liveConfig ? {
  registrationId: liveConfig.registrationId,
  generationId: 'cluster-mesh-session-v1',
  principalId: 'workload:cluster-mesh-a1-live',
  workspaceId: 'workspace:cluster-mesh-a1-live',
  custodyHolderPrincipalId: 'workload:cluster-mesh-a1-live',
  custodyEpoch: 1,
  actuatorRef: LIVE_H2A_ACTUATOR_REF,
  status: 'active',
  expiresAt: liveExpiresAt,
  leaseExpiresAt: liveExpiresAt,
} : undefined;
let liveInitialization: Promise<void> | undefined;
const ensureLiveRegistration = async () => {
  if (!livePorts || !liveRegistration) throw new Error('live h2a qualification is not configured');
  liveInitialization ??= (async () => {
    await livePorts.validate();
    await runtimeStore.saveGeneration({
      generationId: liveRegistration.generationId,
      status: 'active',
      supervisorRef: `mcp-supervisor:${liveRegistration.generationId}`,
      supervisorLeaseExpiresAt: liveRegistration.leaseExpiresAt,
      maxConcurrent: 12,
      poolSize: 4,
    });
    await runtimeStore.saveRegistration(liveRegistration);
  })().catch((error) => {
    liveInitialization = undefined;
    throw error;
  });
  return liveInitialization;
};

const verifyLiveEvidence: VerifiedInvocationContextPort['verify'] = async (request) => {
  if (!liveConfig || !liveRegistration) throw new Error('live evidence verifier is unavailable');
  const supplied = Buffer.from(request.authorizationEvidenceRef ?? '');
  const expected = Buffer.from(liveConfig.evidence);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('live evidence verification failed');
  }
  await ensureLiveRegistration();
  return {
    invocationId: request.invocationId,
    correlationId: request.correlationId,
    generationId: liveRegistration.generationId,
    principal: {
      principalId: liveRegistration.principalId,
      kind: 'workload',
      verifierId: 'h2a-native-terminal-v1',
    },
    workspace: {
      bindingId: 'binding:cluster-mesh-a1-live',
      workspaceId: liveRegistration.workspaceId,
      revision: '1',
    },
    scopes: ['session:drive', 'cli:invoke'],
    policyRevision: 'cluster-mesh-a1-live-v1',
    issuedAt: new Date().toISOString(),
    registration: {
      registrationId: liveRegistration.registrationId,
      generationId: liveRegistration.generationId,
      workspaceId: liveRegistration.workspaceId,
      actuatorRef: liveRegistration.actuatorRef,
      custodyEpoch: liveRegistration.custodyEpoch,
      expiresAt: liveRegistration.expiresAt,
    },
    custody: {
      custodyId: 'custody:cluster-mesh-a1-live',
      holderPrincipalId: liveRegistration.custodyHolderPrincipalId,
      epoch: liveRegistration.custodyEpoch,
    },
  };
};

export const liveClusterMeshQualification = liveConfig && livePorts && liveRegistration ? {
  evidence: liveConfig.evidence,
  registration: liveRegistration,
  store: runtimeStore,
  ports: livePorts,
  ensureRegistration: ensureLiveRegistration,
} : undefined;

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
  sessionAdmission: {
    generationId: sessionGenerationId,
    store: runtimeStore,
    ensureGeneration: ensureSessionGeneration,
  },
  sessionControl: {
    generationId: sessionGenerationId,
    context: livePorts ? { verify: verifyLiveEvidence } : {
      verify: meshInvocationVerifier.verify,
    },
    runtimeStore,
    mcpStore: runtimeStore,
    cutovers: new PostgresClusterMeshCutoverStore(),
    pty: livePorts?.pty ?? unavailableH2aPtyPort,
    targets: livePorts?.targets ?? { async inspect() { return 'unknown'; } },
    ptyEvidence: livePorts ? 'adapter_available' : 'BR75-SG1_source_gap',
  },
});
