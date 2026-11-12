import { randomUUID } from 'node:crypto';
import type { ExecutionNodeTenantId } from './contract.js';
import { EXECUTION_NODE_TENANT_SLICE_DEFAULTS } from './contract.js';
import { ExecutionNodeDaemon } from './daemon.js';
import { ExecutionNodeAdmission } from './admission.js';
import { AuditLog } from './audit.js';
import { TenantBaseRegistry } from './mounts.js';
import { FakeRuntimeAdapter, RunscRuntimeAdapter, type RuntimeAdapter } from './runtime-adapter.js';

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

export interface ExecutionNodeConfig {
  readonly nodeId?: string;
  readonly nodeInstanceId?: string;
  readonly nodeEpoch?: number;
  readonly adapter?: RuntimeAdapter;
  readonly useRunsc?: boolean;
  readonly ticketPublicKeyPem?: string;
  readonly now?: () => number;
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
  const admission = new ExecutionNodeAdmission(quotas);
  const audit = new AuditLog(nodeInstanceId, config.now);
  const bases = new TenantBaseRegistry();
  const adapter = config.adapter ?? (config.useRunsc === true ? new RunscRuntimeAdapter() : new FakeRuntimeAdapter());
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
