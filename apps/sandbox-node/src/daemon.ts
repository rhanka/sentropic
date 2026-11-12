import { randomUUID } from 'node:crypto';
import type {
  ExecutionNodeClaimSpec,
  ExecutionNodeExportSpec,
  ExecutionNodeLifecycleState,
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
  ExecutionNodeStopSpec,
  ExecutionNodeTenantId,
} from './contract.js';
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
  slot: 'live' | 'standby' | 'build' | undefined;
  runtimeId: string | undefined;
  outputSubPath: string | undefined;
  exportedBytes: number;
  createdAt: string;
  allProcessesExited: boolean;
  scopeName: string;
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
    if (result instanceof Promise) void result.catch(() => {
      if (this.idempotence.get(`${tenantId}:${commandId}`)?.result === result) {
        this.idempotence.delete(`${tenantId}:${commandId}`);
      }
    });
    return result;
  }

  getSandbox(tenantId: ExecutionNodeTenantId, id: string): SandboxRecord | undefined {
    return this.sandboxes.get(this.key(tenantId, id));
  }

  private releaseSlot(sandbox: SandboxRecord): void {
    if (sandbox.slot) {
      if (sandbox.slot === 'build') this.admission.builds.release(sandbox.tenantId);
      else this.admission.release(sandbox.tenantId, sandbox.slot);
      sandbox.slot = undefined;
    }
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

  async createSandbox(input: {
    spec: ExecutionNodeSandboxSpec;
    ownership: ExecutionNodeOwnership;
    commandId: string;
    ticket?: TicketEnvelope;
    warmStandby?: boolean;
    compatibility?: ExecutionNodeClaimSpec['compatibility'];
  }): Promise<SandboxRecord> {
    if (input.spec.tenantId !== input.ownership.tenantId) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', 'spec/ownership tenant mismatch');
    }
    if (input.ticket) this.requireTicket(input.ticket, input.spec.tenantId);
    const mounts = resolveMounts(input.spec.tenantId, input.spec.baseMounts, this.bases);
    return this.idempotent(input.spec.tenantId, input.commandId, input.spec, async () => {
      const slot = input.spec.profile === 'artifact-build' ? 'build'
        : input.warmStandby === true ? 'standby' : 'live';
      if (slot === 'build') await this.admission.admitBuild(input.spec.tenantId);
      else this.admission.admit(input.spec.tenantId, slot, input.commandId);
      const id = randomUUID();
      const paths = sandboxPaths(input.spec.tenantId, id);
      const record: SandboxRecord = {
        id,
        tenantId: input.spec.tenantId,
        state: input.warmStandby === true ? 'standby' : 'creating',
        ownership: input.ownership,
        slot,
        compatibility: input.warmStandby === true ? input.compatibility : undefined,
        poolOwned: input.warmStandby === true,
        runtimeId: undefined,
        outputSubPath: undefined,
        exportedBytes: 0,
        createdAt: new Date(this.now()).toISOString(),
        allProcessesExited: false,
        scopeName: `builder-sbx-${id}.scope`,
      };
      this.sandboxes.set(this.key(record.tenantId, id), record);
      this.audit.record('sandbox.created', record.tenantId, id, `mounts=${mounts.length}`);
      void paths;
      return record;
    });
  }

  async promoteToRunning(tenantId: ExecutionNodeTenantId, id: string, input: {
    commandId: string;
    quotaMiB: number;
    uid: number;
    gid: number;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (input.ticket) this.requireTicket(input.ticket, tenantId);
    return this.idempotent(tenantId, input.commandId, { id, quotaMiB: input.quotaMiB }, async () => {
      if (sandbox.state !== 'creating' && sandbox.state !== 'standby') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${id} in state ${sandbox.state}`);
      }
      const paths = sandboxPaths(tenantId, id);
      const { runtimeId } = await this.adapter.runSandbox({
        tenantId,
        sandboxUid: id,
        mounts: [],
        overlayUpper: paths.upper,
        overlayWork: paths.work,
        quotaMiB: sandbox.slot === 'build' ? 1664 : 768,
        uid: input.uid,
        gid: input.gid,
      });
      sandbox.runtimeId = runtimeId;
      sandbox.state = 'running';
      this.audit.record('sandbox.running', tenantId, id, runtimeId);
      return sandbox;
    });
  }

  async claimSandbox(input: {
    claim: ExecutionNodeClaimSpec;
    commandId: string;
    standbyId: string;
    quotaMiB: number;
    uid: number;
    gid: number;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    if (input.claim.tenantId !== input.claim.ownership.tenantId) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', 'claim/ownership tenant mismatch');
    }
    if (input.ticket) this.requireTicket(input.ticket, input.claim.tenantId);
    const sandbox = this.getSandbox(input.claim.tenantId, input.standbyId);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${input.standbyId}`);
    return this.idempotent(input.claim.tenantId, input.commandId, input.claim, async () => {
      if (sandbox.state !== 'standby') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${sandbox.id} in state ${sandbox.state}`);
      }
      if (!sandbox.compatibility || !compatEqual(sandbox.compatibility, input.claim.compatibility)) {
        throw new ExecutionNodeError('command_id_payload_mismatch', 'standby compatibility mismatch');
      }
      sandbox.state = 'creating'; // Lock the standby before the first asynchronous runtime call.
      let promoted: SandboxRecord;
      try { promoted = await this.promoteToRunning(input.claim.tenantId, sandbox.id, {
        commandId: `claim-promote:${input.commandId}`,
        quotaMiB: input.quotaMiB,
        uid: input.uid,
        gid: input.gid,
      }); } catch (error) { sandbox.state = 'standby'; throw error; }
      promoted.poolOwned = false;
      promoted.ownership = input.claim.ownership;
      this.admission.claim(input.claim.tenantId);
      promoted.slot = 'live';
      this.audit.record('sandbox.claimed', promoted.tenantId, promoted.id);
      return promoted;
    });
  }

  renewSandbox(tenantId: ExecutionNodeTenantId, id: string): SandboxRecord {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (TERMINAL.has(sandbox.state)) {
      throw new ExecutionNodeError('already_claimed', `sandbox ${id} is ${sandbox.state}`);
    }
    this.audit.record('sandbox.renewed', tenantId, id, sandbox.state);
    return sandbox;
  }

  async stopSandbox(tenantId: ExecutionNodeTenantId, id: string, input: {
    stop: ExecutionNodeStopSpec;
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (input.ticket) this.requireTicket(input.ticket, tenantId);
    if (input.stop.retentionTtlMs !== undefined && input.stop.retentionTtlMs > 300_000) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'retentionTtlMs exceeds 300s');
    }
    return this.idempotent(tenantId, input.commandId, { id, stop: input.stop }, async () => {
      if (sandbox.state !== 'running' && sandbox.state !== 'stopping') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${id} in state ${sandbox.state}`);
      }
      sandbox.state = 'stopping';
      this.audit.record('sandbox.stopping', tenantId, id);
      sandbox.allProcessesExited = sandbox.runtimeId ? await this.adapter.stopSandbox(sandbox.runtimeId) : true;
      if (!sandbox.allProcessesExited) return sandbox;
      this.releaseSlot(sandbox);
      if (input.stop.retainOutput === true) {
        sandbox.state = 'stopped-output-retained';
        sandbox.outputSubPath = input.stop.outputSubPath ?? 'ui/dist';
      } else {
        sandbox.state = 'destroyed';
        this.releaseSlot(sandbox);
      }
      this.audit.record('sandbox.stopped', tenantId, id, sandbox.state);
      return sandbox;
    });
  }

  writeFile(tenantId: ExecutionNodeTenantId, id: string, path: string): void {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (sandbox.state !== 'running') {
      throw new ExecutionNodeError('already_claimed', `sandbox ${id} is ${sandbox.state}, writes require running`);
    }
    checkWritePath(path);
    this.audit.record('sandbox.write', tenantId, id, path);
  }

  async exportArtifacts(tenantId: ExecutionNodeTenantId, id: string, input: {
    spec: ExecutionNodeExportSpec;
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<{ bytes: Buffer; sandbox: SandboxRecord }> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (input.ticket) this.requireTicket(input.ticket, tenantId);
    if (input.spec.maxBytes <= 0) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'maxBytes must be positive');
    }
    return this.idempotent(tenantId, input.commandId, { id, spec: input.spec }, async () => {
      if (sandbox.state !== 'stopped-output-retained' && sandbox.state !== 'exported') {
        throw new ExecutionNodeError('sandbox_not_quiesced', `sandbox ${id} is ${sandbox.state}`);
      }
      if (!sandbox.allProcessesExited) throw new ExecutionNodeError('sandbox_not_quiesced');
      if (!input.spec.buildId) throw new ExecutionNodeError('command_id_payload_mismatch', 'buildId required');
      if (!sandbox.runtimeId) {
        throw new ExecutionNodeError('unknown_node_instance', `sandbox ${id} has no runtime output`);
      }
      const bytes = await this.adapter.exportOutput(sandbox.runtimeId, input.spec.subPath);
      if (bytes.length > input.spec.maxBytes) {
        throw new ExecutionNodeError('command_id_payload_mismatch', 'export exceeds maxBytes');
      }
      sandbox.state = 'exported';
      sandbox.exportedBytes = bytes.length;
      this.audit.record('sandbox.exported', tenantId, id, `${bytes.length}B`);
      return { bytes, sandbox };
    });
  }

  async deleteSandbox(tenantId: ExecutionNodeTenantId, id: string, input: {
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (input.ticket) this.requireTicket(input.ticket, tenantId);
    return this.idempotent(tenantId, input.commandId, { id }, async () => {
      if (sandbox.state === 'running') {
        throw new ExecutionNodeError('sandbox_still_running', `sandbox ${id} is running`);
      }
      if (sandbox.runtimeId) await this.adapter.destroySandbox(sandbox.runtimeId);
      sandbox.runtimeId = undefined;
      sandbox.state = 'destroyed';
      this.releaseSlot(sandbox);
      this.audit.record('sandbox.destroyed', tenantId, id);
      return sandbox;
    });
  }

  failSandbox(tenantId: ExecutionNodeTenantId, id: string, detail?: string): SandboxRecord {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    if (!TERMINAL.has(sandbox.state)) {
      sandbox.state = 'failed';
      this.releaseSlot(sandbox);
      this.audit.record('sandbox.failed', tenantId, id, detail);
    }
    return sandbox;
  }
}
