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
import { createLocalProjectionDomain, type LocalProjectionPort, type ProjectionDomain, type ProjectionKind } from './projection.js';
import { createTokenExchangeClient, type TokenExchangeClientInput } from './token-exchange.js';
import { createGatedTrustDomain, type TrustDomain } from './trust.js';
import type { ClusterMeshModules, ModuleCapabilityMap } from './modules/contracts.js';

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
    readonly localDevices: 'available' | 'gated';
    readonly localProjection: 'available' | 'gated';
    /** Effective kinds; optional for compatibility with older capability providers. */
    readonly localProjectionKinds?: readonly ProjectionKind[];
    readonly interServerDirectory: 'gated';
    /** 'available' when a token-exchange issuer binding is configured, 'gated' otherwise. */
    readonly tokenExchange: 'available' | 'gated';
    readonly memoryReplication: 'gated';
    /** Package availability snapshot; present only when a module registry is injected. */
    readonly modules?: ModuleCapabilityMap;
  };
}

/** @deprecated Removal locator: delete after its remaining callers cut over in Lots 4–32. */
export function createDegenerateClusterMesh(input: {
  readonly self: ClusterNodeDescriptor;
  readonly workstations: LocalWorkstationDirectoryPort;
  readonly memberships: ValidatedMembershipPort;
  readonly projections: LocalProjectionPort;
  readonly nhiRunner?: CommandRunnerPort;
  readonly nhi?: NhiLifecyclePort;
  readonly devices: LocalDeviceAttachmentPort;
  readonly modules?: ClusterMeshModules;
  /**
   * RFC 8693 exchange binding plus policy. The client is built eagerly: an invalid
   * policy throws here, so `available` always follows a successful local preflight.
   * Absent: the seam stays gated. Issuer reachability remains a runtime condition.
   */
  readonly tokenExchange?: TokenExchangeClientInput;
}): ClusterMesh {
  if (input.nhi !== undefined) {
    for (const method of ['attest', 'offboard', 'exportBundle'] as const) {
      if (typeof input.nhi?.[method] !== 'function') {
        throw new TypeError(`nhi.${method} must be a function`);
      }
    }
  }
  const nhi = input.nhi ?? (input.nhiRunner ? createH2aNhiLifecycle(input.nhiRunner) : undefined);
  if (!nhi) throw new TypeError('nhi or nhiRunner is required');
  const tokenExchangeClient = input.tokenExchange ? createTokenExchangeClient(input.tokenExchange) : undefined;
  const boundaries = createBoundaryDomain({
    homeNodeId: input.self.nodeId,
    memberships: input.memberships,
  });
  const capabilities: ClusterMesh['capabilities'] = {
    mode: 'single-node',
    get localDevices() { return input.devices.availability ?? 'available'; },
    get localProjection() { return input.projections.availability ?? 'available'; },
    get localProjectionKinds(): readonly ProjectionKind[] {
      if (input.projections.availability === 'gated') return [];
      return [...(input.projections.supportedKinds ?? ['human_identity', 'agent_identity', 'memory_snapshot'])];
    },
    interServerDirectory: 'gated',
    get tokenExchange() { return tokenExchangeClient ? 'available' : 'gated'; },
    memoryReplication: 'gated',
  };
  const modules = input.modules;
  if (modules) {
    // Live getter over the registry; absent for callers that inject no registry.
    Object.defineProperty(capabilities, 'modules', { get: () => modules.snapshot(), enumerable: true });
  }
  return {
    membership: createSingleNodeMembership({ ...input, boundaries }),
    trust: tokenExchangeClient ? { tokenExchange: tokenExchangeClient } : createGatedTrustDomain(),
    wrap: {
      projections: createLocalProjectionDomain({ homeNodeId: input.self.nodeId, local: input.projections }),
      nhi,
      memoryReplication: createGatedMemoryReplication(),
    },
    devices: createLocalDeviceDomain(input.devices),
    boundaries,
    capabilities,
  };
}
