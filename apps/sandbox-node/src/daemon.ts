import { randomUUID } from 'node:crypto';
import type {
  ExecutionNodeClaimSpec,
  ExecutionNodeExportSpec,
  ExecutionNodeLifecycleState,
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
  ExecutionNodeStopSpec,
  ExecutionNodeTenantId,
} from '../../../packages/contracts/src/execution-node-v1.js';
import { ExecutionNodeError } from './errors.js';
import { checkTicket, sha256Hex, verifyTicketSignature } from './tickets.js';
import type { RuntimeAdapter } from './runtime-adapter.js';
import { ExecutionNodeAdmission } from './admission.js';
import { AuditLog } from './audit.js';
import { TenantBaseRegistry, checkWritePath, resolveMounts, sandboxPaths } from './mounts.js';

export interface SandboxRecord {
  readonly id: string;
  readonly tenantId: ExecutionNodeTenantId;
  state: ExecutionNodeLifecycleState;
  ownership: ExecutionNodeOwnership;
  compatibility: ExecutionNodeClaimSpec['compatibility'] | undefined;
  poolOwned: boolean;
  runtimeId: string | undefined;
  outputSubPath: string | undefined;
  exportedBytes: number;
  createdAt: string;
}

export interface DaemonOptions {
  readonly nodeId: string;
  readonly nodeInstanceId: string;
  nodeEpoch: number;
  readonly adapter: RuntimeAdapter;
  readonly admission: ExecutionNodeAdmission;
  readonly audit: AuditLog;
  readonly bases: TenantBaseRegistry;
  readonly ticketPublicKeyPem?: string;
  readonly now?: () => number;
}

interface TicketEnvelope {
  readonly ticket: Parameters<typeof checkTicket>[0];
  readonly signature: string;
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}

function compatEqual(
  left: ExecutionNodeClaimSpec['compatibility'],
  right: ExecutionNodeClaimSpec['compatibility'],
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.repoId === right.repoId &&
    left.sourceTreeSha256 === right.sourceTreeSha256 &&
    left.lockSha256 === right.lockSha256 &&
    left.prebundleDigest === right.prebundleDigest &&
    left.rootfsBaseDigest === right.rootfsBaseDigest &&
    left.profile === right.profile &&
    left.viteConfigDigest === right.viteConfigDigest
  );
}

const TERMINAL: ReadonlySet<ExecutionNodeLifecycleState> = new Set(['destroyed']);

export class ExecutionNodeDaemon {
  readonly nodeId: string;
  readonly nodeInstanceId: string;
  nodeEpoch: number;
  private readonly adapter: RuntimeAdapter;
  private readonly admission: ExecutionNodeAdmission;
  private readonly audit: AuditLog;
  private readonly bases: TenantBaseRegistry;
  private readonly ticketPublicKeyPem?: string;
  private readonly now: () => number;
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly idempotence = new Map<string, { bodyHash: string; result: unknown }>();

  constructor(options: DaemonOptions) {
    this.nodeId = options.nodeId;
    this.nodeInstanceId = options.nodeInstanceId;
    this.nodeEpoch = options.nodeEpoch;
    this.adapter = options.adapter;
    this.admission = options.admission;
    this.audit = options.audit;
    this.bases = options.bases;
    this.ticketPublicKeyPem = options.ticketPublicKeyPem;
    this.now = options.now ?? Date.now;
  }

  private key(tenantId: ExecutionNodeTenantId, id: string): string {
    return `${tenantId}:${id}`;
  }

  private requireTicket(envelope: TicketEnvelope, tenantId: ExecutionNodeTenantId): void {
    if (!this.ticketPublicKeyPem) return;
    if (!verifyTicketSignature(envelope.ticket, envelope.signature, this.ticketPublicKeyPem)) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket signature invalid');
    }
    checkTicket(envelope.ticket, {
      method: envelope.method,
      path: envelope.path,
      bodySha256: sha256Hex(JSON.stringify(envelope.body ?? null)),
      nodeInstanceId: this.nodeInstanceId,
      nodeEpoch: this.nodeEpoch,
      now: this.now(),
    });
    if (envelope.ticket.ownership.tenantId !== tenantId) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', 'ticket tenant mismatch');
    }
  }

  private idempotent<T>(tenantId: ExecutionNodeTenantId, commandId: string, body: unknown, produce: () => T): T {
    const slot = this.idempotence.get(`${tenantId}:${commandId}`);
    const bodyHash = sha256Hex(JSON.stringify(body ?? null));
    if (slot) {
      if (slot.bodyHash !== bodyHash) {
        throw new ExecutionNodeError('command_id_payload_mismatch', `command ${commandId} replayed with a different body`);
      }
      return slot.result as T;
    }
    const result = produce();
    this.idempotence.set(`${tenantId}:${commandId}`, { bodyHash, result });
    return result;
  }

  getSandbox(tenantId: ExecutionNodeTenantId, id: string): SandboxRecord | undefined {
    const sandbox = this.sandboxes.get(this.key(tenantId, id));
    return sandbox;
  }

  /** Cross-tenant access by id fails closed without leaking existence. */
  peekSandbox(requesterTenant: ExecutionNodeTenantId, id: string): SandboxRecord | undefined {
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.id === id) {
        if (sandbox.tenantId !== requesterTenant) {
          this.audit.record('sandbox.cross_tenant_denied', requesterTenant, id);
          throw new ExecutionNodeError('cross_tenant_base_forbidden', `sandbox ${id} not visible to ${requesterTenant}`);
        }
        return sandbox;
      }
    }
    return undefined;
  }

  listSandboxes(tenantId: ExecutionNodeTenantId): SandboxRecord[] {
    return [...this.sandboxes.values()].filter(sandbox => sandbox.tenantId === tenantId);
  }
}
