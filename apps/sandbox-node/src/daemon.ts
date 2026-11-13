import { randomUUID } from 'node:crypto';
import { validateDiskQuota } from './disk-quota.js';
import { requireNetworkPolicy } from './network-policy.js';
import type {
  ExecutionNodeClaimSpec,
  ExecutionNodeDevScope,
  ExecutionNodeExportSpec,
  ExecutionNodeLifecycleState,
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
  ExecutionNodeStopSpec,
  ExecutionNodeTenantId,
} from './contract.js';
import { ExecutionNodeError } from './errors.js';
import { checkTicket, sha256Hex, verifyTicketSignature } from './tickets.js';
import type { RuntimeAdapter, SandboxMount } from './runtime-adapter.js';
import { ExecutionNodeAdmission } from './admission.js';
import { AuditLog } from './audit.js';
import { SERVICE_TIMEOUT_MS, type HeavyProfile } from './build-queue.js';
import { TenantBaseRegistry, checkWritePath, resolveMounts, sandboxPaths, validateDevScope } from './mounts.js';

export interface SandboxRecord {
  readonly profile?: string;
  readonly network?: 'none' | 'ports';
  readonly diskQuotaMiB: number;
  readonly quotaInodes: number;
  readonly devScope: ExecutionNodeDevScope;
  readonly mounts: readonly SandboxMount[];
  readonly command: readonly string[];
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
  readonly stateRoot?: string;
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

export interface TicketEnvelope {
  readonly ticket: Parameters<typeof checkTicket>[0];
  readonly signature: string;
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
  private readonly stateRoot?: string;
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
  private readonly launches = new Map<string, Promise<SandboxRecord>>();
  private readonly retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly transitions = new Map<string, Promise<unknown>>();
  private readonly idempotence = new Map<string, { method: string; path: string; bodySha256: string; result: unknown }>();

  constructor(options: DaemonOptions) {
    this.stateRoot = options.stateRoot;
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

  private transition<T>(id: string, produce: () => Promise<T>): Promise<T> {
    const previous = this.transitions.get(id);
    const result = (async () => {
      await previous?.catch(() => {});
      await this.launches.get(id)?.catch(() => {});
      return produce();
    })().finally(() => { if (this.transitions.get(id) === result) this.transitions.delete(id); });
    this.transitions.set(id, result);
    return result;
  }
  private requireScope(sandbox: SandboxRecord, scope: ExecutionNodeDevScope): void {
    validateDevScope(scope);
    if (JSON.stringify(scope) !== JSON.stringify(sandbox.devScope)) throw new ExecutionNodeError('command_id_payload_mismatch', 'session devScope mismatch');
  }

  authorizeCommand(envelope: TicketEnvelope | undefined, tenantId: ExecutionNodeTenantId,
    commandId: string, body: unknown, method: string, path: string, ownership: ExecutionNodeOwnership): void {
    if (!this.ticketPublicKeyPem) return;
    if (!envelope) throw new ExecutionNodeError('custody_revoked', 'execution ticket required');
    if (!verifyTicketSignature(envelope.ticket, envelope.signature, this.ticketPublicKeyPem)) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket signature invalid');
    }
    checkTicket(envelope.ticket, {
      method,
      path,
      bodySha256: sha256Hex(JSON.stringify(body)),
      nodeInstanceId: this.nodeInstanceId,
      nodeEpoch: this.nodeEpoch,
      now: this.now(),
    });
    if (envelope.ticket.tenantId !== tenantId || envelope.ticket.ownership.tenantId !== tenantId
      || envelope.ticket.targetNodeId !== this.nodeId || envelope.ticket.commandId !== commandId
      || JSON.stringify(envelope.ticket.ownership) !== JSON.stringify(ownership)) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', 'ticket tenant mismatch');
    }
  }

  private idempotent<T>(tenantId: ExecutionNodeTenantId, commandId: string, method: string, path: string,
    body: unknown, produce: () => T, retainValue = true): T {
    const slot = this.idempotence.get(`${tenantId}:${commandId}`);
    const bodySha256 = sha256Hex(JSON.stringify(body));
    if (slot) {
      if (slot.method !== method || slot.path !== path || slot.bodySha256 !== bodySha256) {
        throw new ExecutionNodeError('command_id_payload_mismatch', `command ${commandId} replayed with a different request`);
      }
      if (slot.result !== undefined) return slot.result as T;
    }
    const result = produce();
    this.idempotence.set(`${tenantId}:${commandId}`, { method, path, bodySha256, result });
    if (!retainValue && result instanceof Promise) void result.then(() => {
      const entry = this.idempotence.get(`${tenantId}:${commandId}`);
      if (entry?.result === result) entry.result = undefined;
    }, () => {});
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
  activeCount(tenantId: ExecutionNodeTenantId): number {
    return [...this.sandboxes.values()].filter(sandbox => sandbox.tenantId === tenantId
      && ['creating', 'standby', 'running', 'stopping'].includes(sandbox.state)).length;
  }

  private releaseSlot(sandbox: SandboxRecord): void {
    clearTimeout(this.retentionTimers.get(sandbox.id));
    this.retentionTimers.delete(sandbox.id);
    if (sandbox.slot) {
      if (sandbox.slot === 'build') this.admission.builds.release(sandbox.tenantId);
      else this.admission.release(sandbox.tenantId, sandbox.slot);
      sandbox.slot = undefined;
    }
  }

  private retainOutput(sandbox: SandboxRecord, subPath = 'ui/dist', ttlMs = 300_000): void {
    if (sandbox.slot === 'build') this.admission.builds.finishExecution(sandbox.tenantId);
    sandbox.state = 'stopped-output-retained';
    sandbox.outputSubPath = subPath;
    const timer = setTimeout(() => {
      void this.transition(sandbox.id, async () => {
        if (!['stopped-output-retained', 'exported'].includes(sandbox.state)) return;
        if (sandbox.runtimeId) await this.adapter.destroySandbox(sandbox.runtimeId);
        sandbox.runtimeId = undefined; sandbox.state = 'destroyed'; this.releaseSlot(sandbox);
        this.audit.record('sandbox.destroyed', sandbox.tenantId, sandbox.id, 'retention expired');
      }).catch(error => this.audit.record('sandbox.cleanup_failed', sandbox.tenantId, sandbox.id, String(error)));
    }, ttlMs);
    timer.unref();
    this.retentionTimers.set(sandbox.id, timer);
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

  async disablePorts(): Promise<void> {
    await Promise.all([...this.sandboxes.values()].filter(box => box.network === 'ports' && box.state !== 'destroyed')
      .map(box => this.transition(box.id, async () => {
        if (box.runtimeId) await this.adapter.destroySandbox(box.runtimeId);
        box.runtimeId = undefined; box.state = 'destroyed'; box.allProcessesExited = true;
        this.releaseSlot(box); this.audit.record('sandbox.ports_disabled', box.tenantId, box.id);
      })));
  }

  async createSandbox(input: {
    spec: ExecutionNodeSandboxSpec;
    ownership: ExecutionNodeOwnership;
    commandId: string;
    ticket?: TicketEnvelope;
    warmStandby?: boolean;
    compatibility?: ExecutionNodeClaimSpec['compatibility'];
  }): Promise<SandboxRecord> {
    input = structuredClone(input);
    requireNetworkPolicy(input.spec.network, input.spec.profile);
    validateDevScope(input.spec.devScope);
    validateDiskQuota(input.spec.quotaMiB, input.spec.quotaInodes);
    if (input.spec.tenantId !== input.ownership.tenantId) {
      throw new ExecutionNodeError('cross_tenant_base_forbidden', 'spec/ownership tenant mismatch');
    }
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, input.spec.tenantId, input.commandId, body, 'POST', '/v1/sandboxes', input.ownership);
    const admittedEpoch = this.nodeEpoch;
    const mounts = resolveMounts(input.spec.tenantId, input.spec.baseMounts, this.bases);
    return this.idempotent(input.spec.tenantId, input.commandId, 'POST', '/v1/sandboxes', body, async () => {
      const id = randomUUID();
      const slot = Object.hasOwn(SERVICE_TIMEOUT_MS, input.spec.profile) ? 'build'
        : input.warmStandby === true ? 'standby' : 'live';
      if (slot === 'build') await this.admission.admitBuild(input.spec.tenantId, input.spec.profile as HeavyProfile, async () => {
        await this.transition(id, async () => {
        const sandbox = this.getSandbox(input.spec.tenantId, id)!;
        if (['stopped-output-retained', 'exported', 'destroyed'].includes(sandbox.state)) return;
        sandbox.state = 'failed';
        sandbox.allProcessesExited = sandbox.runtimeId ? await this.adapter.stopSandbox(sandbox.runtimeId) : true;
        this.audit.record('sandbox.failed', sandbox.tenantId, id, 'service timeout');
        if (sandbox.allProcessesExited) {
          if (sandbox.runtimeId) await this.adapter.destroySandbox(sandbox.runtimeId);
          sandbox.runtimeId = undefined; sandbox.state = 'destroyed'; this.releaseSlot(sandbox);
        }
        });
      });
      else this.admission.admit(input.spec.tenantId, slot, input.commandId);
      // Authentication grants this immutable queue entry; ticket expiry is not a service deadline.
      try { if (this.nodeEpoch !== admittedEpoch) throw new ExecutionNodeError('custody_revoked', 'queued node epoch changed'); }
      catch (error) {
        if (slot === 'build') this.admission.builds.release(input.spec.tenantId);
        else this.admission.release(input.spec.tenantId, slot);
        throw error;
      }
      const paths = sandboxPaths(input.spec.tenantId, id, this.stateRoot);
      const record: SandboxRecord = {
        diskQuotaMiB: input.spec.quotaMiB, quotaInodes: input.spec.quotaInodes,
        devScope: structuredClone(input.spec.devScope),
        network: input.spec.network,
        profile: input.spec.profile,
        mounts,
        command: input.spec.command ?? ['/bin/sleep', 'infinity'],
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
      this.audit.record('sandbox.created', record.tenantId, id, JSON.stringify({ mounts: mounts.length, devScope: record.devScope }));
      void paths;
      return record;
    });
  }

  async promoteToRunning(tenantId: ExecutionNodeTenantId, id: string, input: {
    devScope: ExecutionNodeDevScope;
    commandId: string;
    quotaMiB: number;
    uid: number;
    gid: number;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    this.requireScope(sandbox, input.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${id}/start`, sandbox.ownership);
    return this.idempotent(tenantId, input.commandId, 'POST', `/v1/sandboxes/${id}/start`, body, () => this.startRuntime(sandbox, input));
  }

  private startRuntime(sandbox: SandboxRecord, input: { uid: number; gid: number }): Promise<SandboxRecord> {
    if (this.launches.has(sandbox.id)) return Promise.reject(new ExecutionNodeError('already_claimed'));
    const pending = this.launchRuntime(sandbox, input).finally(() => { this.launches.delete(sandbox.id); });
    this.launches.set(sandbox.id, pending);
    return pending;
  }

  private async runtimeExited(sandbox: SandboxRecord, code: number | null): Promise<void> {
    await this.launches.get(sandbox.id);
    if (sandbox.state !== 'running') return;
    if (code !== 0) { await this.failSandbox(sandbox.tenantId, sandbox.id, `runtime exited: ${code}`); return; }
    await this.transition(sandbox.id, async () => {
    if (sandbox.state !== 'running') return;
    sandbox.state = 'stopping';
    sandbox.allProcessesExited = await this.adapter.stopSandbox(sandbox.runtimeId!);
    if (sandbox.allProcessesExited) {
      this.retainOutput(sandbox);
      this.audit.record('sandbox.stopped', sandbox.tenantId, sandbox.id, sandbox.state);
    }
    });
  }

  private async launchRuntime(sandbox: SandboxRecord, input: { uid: number; gid: number }): Promise<SandboxRecord> {
      const { id, tenantId } = sandbox;
      if (sandbox.state !== 'creating' && sandbox.state !== 'standby') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${id} in state ${sandbox.state}`);
      }
      const paths = sandboxPaths(tenantId, id, this.stateRoot);
      const { runtimeId } = await this.adapter.runSandbox({
        tenantId,
        sandboxUid: id,
        mounts: sandbox.mounts,
        command: sandbox.command,
        network: sandbox.network,
        profile: sandbox.profile,
        onExit: code => {
          void Promise.resolve().then(() => this.runtimeExited(sandbox, code)).catch(error => {
            this.audit.record('sandbox.stop_failed', tenantId, id, String(error));
          });
        },
        overlayUpper: paths.upper,
        overlayWork: paths.work,
        quotaMiB: sandbox.slot === 'build' ? 1536 : 704,
        diskQuotaMiB: sandbox.diskQuotaMiB, quotaInodes: sandbox.quotaInodes,
        uid: input.uid,
        gid: input.gid,
      }).catch(async error => {
        if (error instanceof ExecutionNodeError && error.code === 'network_isolation_violation') {
          this.audit.record('sandbox.network_isolation_violation', tenantId, id);
          const runtimeId = (error as { runtimeId?: string }).runtimeId;
          if (runtimeId) await this.adapter.destroySandbox(runtimeId);
          sandbox.runtimeId = undefined; sandbox.state = 'destroyed'; sandbox.allProcessesExited = true;
          this.releaseSlot(sandbox); throw error;
        }
        sandbox.runtimeId = (error as { runtimeId?: string }).runtimeId;
        sandbox.state = 'failed'; throw error;
      });
      sandbox.runtimeId = runtimeId;
      sandbox.state = 'running';
      this.audit.record('sandbox.running', tenantId, id, runtimeId);
      return sandbox;
  }

  async claimSandbox(input: {
    devScope: ExecutionNodeDevScope;
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
    const { ticket, standbyId, ...body } = input;
    this.authorizeCommand(ticket, input.claim.tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${standbyId}/claim`, input.claim.ownership);
    const sandbox = this.getSandbox(input.claim.tenantId, input.standbyId);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${input.standbyId}`);
    this.requireScope(sandbox, input.devScope);
    return this.idempotent(input.claim.tenantId, input.commandId, 'POST', `/v1/sandboxes/${standbyId}/claim`, body, async () => {
      if (sandbox.state !== 'standby') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${sandbox.id} in state ${sandbox.state}`);
      }
      if (!sandbox.compatibility || !compatEqual(sandbox.compatibility, input.claim.compatibility)) {
        throw new ExecutionNodeError('command_id_payload_mismatch', 'standby compatibility mismatch');
      }
      sandbox.state = 'creating'; // Lock the standby before the first asynchronous runtime call.
      let promoted: SandboxRecord;
      try { promoted = await this.startRuntime(sandbox, {
        uid: input.uid,
        gid: input.gid,
      }); } catch (error) { sandbox.state = 'failed'; throw error; }
      promoted.poolOwned = false;
      promoted.ownership = input.claim.ownership;
      this.admission.claim(input.claim.tenantId);
      promoted.slot = 'live';
      this.audit.record('sandbox.claimed', promoted.tenantId, promoted.id);
      return promoted;
    });
  }

  renewSandbox(tenantId: ExecutionNodeTenantId, id: string, input: { devScope: ExecutionNodeDevScope; commandId: string; ticket?: TicketEnvelope }): SandboxRecord {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    this.requireScope(sandbox, input.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${id}/renew`, sandbox.ownership);
    if (TERMINAL.has(sandbox.state)) {
      throw new ExecutionNodeError('already_claimed', `sandbox ${id} is ${sandbox.state}`);
    }
    this.audit.record('sandbox.renewed', tenantId, id, sandbox.state);
    return sandbox;
  }

  async stopSandbox(tenantId: ExecutionNodeTenantId, id: string, input: {
    devScope: ExecutionNodeDevScope;
    stop: ExecutionNodeStopSpec;
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    this.requireScope(sandbox, input.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${id}/stop`, sandbox.ownership);
    if (input.stop.retentionTtlMs !== undefined && (!Number.isFinite(input.stop.retentionTtlMs)
      || input.stop.retentionTtlMs < 0 || input.stop.retentionTtlMs > 300_000)) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'retentionTtlMs must be between 0 and 300s');
    }
    return this.idempotent(tenantId, input.commandId, 'POST', `/v1/sandboxes/${id}/stop`, body, () => this.transition(id, async () => {
      if (['stopped-output-retained', 'exported', 'destroyed'].includes(sandbox.state)) return sandbox;
      if (sandbox.state !== 'running' && sandbox.state !== 'stopping') {
        throw new ExecutionNodeError('already_claimed', `sandbox ${id} in state ${sandbox.state}`);
      }
      sandbox.state = 'stopping';
      this.audit.record('sandbox.stopping', tenantId, id);
      sandbox.allProcessesExited = sandbox.runtimeId ? await this.adapter.stopSandbox(sandbox.runtimeId) : true;
      if (!sandbox.allProcessesExited) return sandbox;
      if (input.stop.retainOutput === true) {
        this.retainOutput(sandbox, input.stop.outputSubPath, input.stop.retentionTtlMs);
      } else {
        if (sandbox.runtimeId) await this.adapter.destroySandbox(sandbox.runtimeId);
        sandbox.runtimeId = undefined;
        sandbox.state = 'destroyed';
        this.releaseSlot(sandbox);
      }
      this.audit.record('sandbox.stopped', tenantId, id, sandbox.state);
      return sandbox;
    }), false);
  }

  async writeFile(tenantId: ExecutionNodeTenantId, id: string, input: {
    path: string; commandId: string; devScope: ExecutionNodeDevScope; contentBase64: string; ticket?: TicketEnvelope;
  }): Promise<void> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    const path = input.path;
    checkWritePath(path, sandbox.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${id}/write`, sandbox.ownership);
    this.requireScope(sandbox, input.devScope);
    return this.idempotent(tenantId, input.commandId, 'POST', `/v1/sandboxes/${id}/write`, body, async () => {
      if (sandbox.state !== 'running' || !sandbox.runtimeId) {
        throw new ExecutionNodeError('already_claimed', `sandbox ${id} is ${sandbox.state}, writes require running`);
      }
      await this.adapter.writeFile(sandbox.runtimeId, path, Buffer.from(input.contentBase64, 'base64'), sandbox.devScope);
      this.audit.record('sandbox.write', tenantId, id, path);
    });
  }

  async exportArtifacts(tenantId: ExecutionNodeTenantId, id: string, input: {
    devScope: ExecutionNodeDevScope;
    spec: ExecutionNodeExportSpec;
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<{ bytes: Buffer; sandbox: SandboxRecord }> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    this.requireScope(sandbox, input.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'POST', `/v1/sandboxes/${id}/export`, sandbox.ownership);
    if (input.spec.maxBytes <= 0) {
      throw new ExecutionNodeError('command_id_payload_mismatch', 'maxBytes must be positive');
    }
    return this.idempotent(tenantId, input.commandId, 'POST', `/v1/sandboxes/${id}/export`, body, () => this.transition(id, async () => {
      if (sandbox.state !== 'stopped-output-retained' && sandbox.state !== 'exported') {
        throw new ExecutionNodeError('sandbox_not_quiesced', `sandbox ${id} is ${sandbox.state}`);
      }
      if (!sandbox.allProcessesExited) throw new ExecutionNodeError('sandbox_not_quiesced');
      if (!input.spec.buildId) throw new ExecutionNodeError('command_id_payload_mismatch', 'buildId required');
      if (!sandbox.runtimeId) {
        throw new ExecutionNodeError('unknown_node_instance', `sandbox ${id} has no runtime output`);
      }
      if (input.spec.subPath !== sandbox.outputSubPath) throw new ExecutionNodeError('command_id_payload_mismatch', 'retained output path mismatch');
      const bytes = await this.adapter.exportOutput(sandbox.runtimeId, input.spec.subPath, input.spec.maxBytes);
      if (bytes.length > input.spec.maxBytes) {
        throw new ExecutionNodeError('command_id_payload_mismatch', 'export exceeds maxBytes');
      }
      sandbox.state = 'exported';
      sandbox.exportedBytes = bytes.length;
      this.audit.record('sandbox.exported', tenantId, id, `${bytes.length}B`);
      return { bytes, sandbox };
    }), false);
  }

  async deleteSandbox(tenantId: ExecutionNodeTenantId, id: string, input: {
    devScope: ExecutionNodeDevScope;
    commandId: string;
    ticket?: TicketEnvelope;
  }): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    this.requireScope(sandbox, input.devScope);
    const { ticket, ...body } = input;
    this.authorizeCommand(ticket, tenantId, input.commandId, body, 'DELETE', `/v1/sandboxes/${id}`, sandbox.ownership);
    return this.idempotent(tenantId, input.commandId, 'DELETE', `/v1/sandboxes/${id}`, body, () => this.transition(id, async () => {
      if (sandbox.state === 'running') {
        throw new ExecutionNodeError('sandbox_still_running', `sandbox ${id} is running`);
      }
      if (sandbox.runtimeId) await this.adapter.destroySandbox(sandbox.runtimeId);
      sandbox.runtimeId = undefined;
      sandbox.state = 'destroyed';
      this.releaseSlot(sandbox);
      this.audit.record('sandbox.destroyed', tenantId, id);
      return sandbox;
    }));
  }

  async failSandbox(tenantId: ExecutionNodeTenantId, id: string, detail?: string): Promise<SandboxRecord> {
    const sandbox = this.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance', `unknown sandbox ${id}`);
    return this.transition(id, async () => {
    if (!TERMINAL.has(sandbox.state)) {
      sandbox.state = 'failed';
      sandbox.allProcessesExited = sandbox.runtimeId ? await this.adapter.stopSandbox(sandbox.runtimeId) : true;
      this.audit.record('sandbox.failed', tenantId, id, detail);
    }
    return sandbox;
    });
  }
}
