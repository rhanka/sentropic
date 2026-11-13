import { randomUUID } from 'node:crypto';
import type { ExecutionNodeTenantId } from './contract.js';
import { EXECUTION_NODE_TENANT_SLICE_DEFAULTS } from './contract.js';
import { ExecutionNodeDaemon } from './daemon.js';
import { ExecutionNodeAdmission } from './admission.js';
import { AuditLog } from './audit.js';
import { TenantBaseRegistry } from './mounts.js';
import { FakeRuntimeAdapter, RunscRuntimeAdapter, type RuntimeAdapter } from './runtime-adapter.js';
import { SandboxCgroup } from './cgroups.js';

export type {
  ExecutionNodeBaseKind,
  ExecutionNodeBaseRef,
  ExecutionNodeClaimSpec,
  ExecutionNodeExportSpec,
  ExecutionNodeLifecycleState,
  ExecutionNodeOwnership,
  ExecutionNodeQuota,
  ExecutionNodeSandboxSpec,
  ExecutionNodeStandbyCompatibility,
  ExecutionNodeStopSpec,
  ExecutionNodeTenantId,
  ExecutionNodeTicket,
} from './contract.js';
export * from './errors.js';
export * from './tickets.js';
export * from './runtime-adapter.js';
export * from './admission.js';
export * from './audit.js';
export * from './mounts.js';
export * from './daemon.js';
export * from './contract.js';
export * from './build-queue.js';
export * from './cgroups.js';
export * from './custody.js';
export * from './recipe-key.js';

export interface ExecutionNodeConfig {
  readonly sharedRootfs?: { path: string; digest: string };
  readonly reservableMiB?: number;
  readonly nodeId?: string;
  readonly nodeInstanceId?: string;
  readonly nodeEpoch?: number;
  readonly adapter?: RuntimeAdapter;
  readonly useRunsc?: boolean;
  readonly ticketPublicKeyPem?: string;
  readonly now?: () => number;
  readonly memoryCurrentMiB?: (tenantId: ExecutionNodeTenantId) => number;
}

export function createExecutionNode(config: ExecutionNodeConfig = {}): {
  daemon: ExecutionNodeDaemon;
  admission: ExecutionNodeAdmission;
  audit: AuditLog;
  bases: TenantBaseRegistry;
  adapter: RuntimeAdapter;
} {
  const nodeInstanceId = config.nodeInstanceId ?? randomUUID();
  const quotas = {
    sentropic: {
      maxLive: 1,
      maxStandby: 1,
    },
    immo: {
      maxLive: 1,
      maxStandby: 1,
    },
  } satisfies Record<ExecutionNodeTenantId, { maxLive: number; maxStandby: number }>;
  void EXECUTION_NODE_TENANT_SLICE_DEFAULTS;
  const adapter = config.adapter ?? (config.useRunsc === true ? new RunscRuntimeAdapter() : new FakeRuntimeAdapter());
  if (adapter.kind === 'runsc-systrap' && !config.ticketPublicKeyPem) throw new Error('runsc requires an execution ticket verification key');
  const admission = new ExecutionNodeAdmission(quotas, { reservableMiB: config.reservableMiB,
    memorySwapCurrentMiB: adapter.kind === 'runsc-systrap' ? tenantId => new SandboxCgroup().tenantMemoryMiB(tenantId, true) : undefined,
    memoryCurrentMiB: config.memoryCurrentMiB
    ?? (adapter.kind === 'runsc-systrap' ? tenantId => new SandboxCgroup().tenantMemoryMiB(tenantId) : undefined) });
  const audit = new AuditLog(nodeInstanceId, config.now);
  const bases = new TenantBaseRegistry(config.sharedRootfs);
  if (config.sharedRootfs) {
    if (!/^[a-f0-9]{64}$/.test(config.sharedRootfs.digest)) throw new Error('invalid shared rootfs digest');
    for (const tenantId of ['sentropic', 'immo'] as const) bases.register({ tenantId,
      baseId: 'shared-rootfs', kind: 'rootfs', identityDigest: config.sharedRootfs.digest });
  }
  const daemon = new ExecutionNodeDaemon({
    nodeId: config.nodeId ?? 'artifact-builder-vm-1',
    nodeInstanceId,
    nodeEpoch: config.nodeEpoch ?? 1,
    adapter,
    admission,
    audit,
    bases,
    ticketPublicKeyPem: config.ticketPublicKeyPem,
    now: config.now,
  });
  return { daemon, admission, audit, bases, adapter };
}
