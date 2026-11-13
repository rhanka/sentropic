import { describe, expect, it } from 'vitest';
import type {
  ExecutionNodeClaimSpec,
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
} from '../src/index.js';
import { createExecutionNode, ExecutionNodeError, FakeRuntimeAdapter, generateTicketKeyPair, issueTicket, sha256Hex } from '../src/index.js';

function ownership(tenantId: 'sentropic' | 'immo' = 'sentropic'): ExecutionNodeOwnership {
  return {
    tenantId,
    poolOwned: false,
    workspaceId: 'ws-1',
    principalId: 'user-1',
    attemptId: 'attempt-1',
    purpose: 'test',
    generation: 1,
    custodyEpoch: 1,
  };
}

function spec(): ExecutionNodeSandboxSpec {
  return {
    command: ['/bin/sleep', 'infinity'],
    tenantId: 'sentropic',
    devScope: { kind: 'ui', writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'fixture', path: 'registry.ts', commit: 'abc' } },
    physicalUid: 'uid-1',
    profile: 'node-22',
    runtimeClass: 'gvisor',
    baseMounts: [],
    quotaMiB: 512,
    quotaInodes: 1000,
    uid: 1000,
    gid: 1000,
    network: 'none',
    allowExec: true,
    allowPty: false,
    allowSnapshots: false,
  };
}

function compat(tenantId: 'sentropic' | 'immo' = 'sentropic'): ExecutionNodeClaimSpec['compatibility'] {
  return {
    tenantId,
    repoId: 'repo',
    sourceTreeSha256: 'src',
    lockSha256: 'lock',
    prebundleDigest: 'pre',
    rootfsBaseDigest: 'root',
    profile: 'node-22',
    viteConfigDigest: 'vite',
  };
}

describe('lifecycle', () => {
  it('should retain successful natural output until export and destruction', async () => {
    class ExitAdapter extends FakeRuntimeAdapter {
      exit?: (code: number | null) => void;
      override async runSandbox(options: Parameters<FakeRuntimeAdapter['runSandbox']>[0]) {
        this.exit = options.onExit; return super.runSandbox(options);
      }
    }
    const adapter = new ExitAdapter();
    const { daemon, admission } = createExecutionNode({ adapter });
    const box = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'natural' });
    await daemon.promoteToRunning('sentropic', box.id, { devScope: spec().devScope, commandId: 'run', uid: 1000, gid: 1000, quotaMiB: 704 });
    adapter.exit!(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(box).toMatchObject({ state: 'stopped-output-retained', allProcessesExited: true });
    expect((await daemon.exportArtifacts('sentropic', box.id, { devScope: spec().devScope, commandId: 'export',
      spec: { buildId: 'b', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 1000 } })).bytes.length).toBeGreaterThan(0);
    await daemon.deleteSandbox('sentropic', box.id, { devScope: spec().devScope, commandId: 'delete' });
    expect(admission.reservedMiB('sentropic')).toBe(0);
  });
  it('should keep the reservation during a suspended launch and concurrent DELETE', async () => {
    let resume!: () => void;
    class SuspendedAdapter extends FakeRuntimeAdapter {
      override async runSandbox(options: Parameters<FakeRuntimeAdapter['runSandbox']>[0]) {
        await new Promise<void>(resolve => { resume = resolve; });
        return super.runSandbox(options);
      }
    }
    const { daemon, admission } = createExecutionNode({ adapter: new SuspendedAdapter() });
    const box = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'suspended' });
    const starting = daemon.promoteToRunning('sentropic', box.id, { devScope: spec().devScope, commandId: 'run', uid: 1000, gid: 1000, quotaMiB: 704 });
    const deleting = daemon.deleteSandbox('sentropic', box.id, { devScope: spec().devScope, commandId: 'delete' });
    const outcome = deleting.catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(admission.reservedMiB('sentropic')).toBe(704);
    await expect(daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'replace' })).rejects.toMatchObject({ status: 429 });
    resume(); await starting;
    expect(await outcome).toMatchObject({ code: 'sandbox_still_running' });
    expect(box.state).toBe('running');
  });
  it('should reject a queued mutation whose ticket expires before admission', async () => {
    let now = 100_000;
    const keys = generateTicketKeyPair();
    const { daemon, admission } = createExecutionNode({ ticketPublicKeyPem: keys.publicKeyPem, nodeInstanceId: 'i', now: () => now });
    const create = (tenantId: 'sentropic' | 'immo') => {
      const body = { spec: { ...spec(), tenantId, profile: 'artifact-build' }, ownership: ownership(tenantId), commandId: tenantId };
      const ticket = issueTicket({ v: 1, tenantId, commandId: tenantId, method: 'POST', path: '/v1/sandboxes',
        bodySha256: sha256Hex(JSON.stringify(body)), targetNodeId: daemon.nodeId, expectedNodeInstanceId: 'i', expectedNodeEpoch: 1,
        ownership: body.ownership, issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30_000).toISOString() }, keys.privateKeyPem);
      return daemon.createSandbox({ ...body, ticket });
    };
    await create('sentropic');
    const waiting = create('immo');
    const outcome = expect(waiting).rejects.toThrow(/expired/);
    now += 30_001;
    admission.builds.release('sentropic');
    await outcome;
    expect(admission.builds.snapshot().holderTenantId).toBeUndefined();
  });
  it('should pass validated base mounts and session command to the runtime', async () => {
    class CaptureAdapter extends FakeRuntimeAdapter {
      options?: Parameters<FakeRuntimeAdapter['runSandbox']>[0];
      override async runSandbox(options: Parameters<FakeRuntimeAdapter['runSandbox']>[0]) {
        this.options = options; return super.runSandbox(options);
      }
    }
    const adapter = new CaptureAdapter();
    const { daemon, bases } = createExecutionNode({ adapter });
    const base = { baseId: 'root', kind: 'rootfs' as const, identityDigest: 'abc' };
    bases.register({ ...base, tenantId: 'sentropic' });
    const box = await daemon.createSandbox({ spec: { ...spec(), baseMounts: [base] }, ownership: ownership(), commandId: 'mount-create' });
    await daemon.promoteToRunning('sentropic', box.id, { devScope: spec().devScope, commandId: 'mount-start', uid: 1000, gid: 1000, quotaMiB: 704 });
    expect(adapter.options?.mounts).toHaveLength(1);
  });
  it('should require signed tickets bound to executed spec, owner, command and node', async () => {
    const keys = generateTicketKeyPair();
    const { daemon } = createExecutionNode({ ticketPublicKeyPem: keys.publicKeyPem, nodeInstanceId: 'instance', now: () => 100_000 });
    const input = { spec: spec(), ownership: ownership(), commandId: 'signed-create' };
    await expect(daemon.createSandbox(input)).rejects.toThrow();
    const ticket = issueTicket({ v: 1, tenantId: 'sentropic', commandId: input.commandId,
      method: 'POST', path: '/v1/sandboxes', bodySha256: sha256Hex(JSON.stringify(input)),
      targetNodeId: daemon.nodeId, expectedNodeInstanceId: 'instance', expectedNodeEpoch: 1,
      ownership: input.ownership, issuedAt: new Date(100_000).toISOString(), deadlineAt: new Date(120_000).toISOString() }, keys.privateKeyPem);
    const envelope = { ...ticket, body: input, method: 'POST', path: '/v1/sandboxes' };
    for (const changed of [{ ...input, spec: { ...spec(), uid: 0 } },
      { ...input, commandId: 'substituted' }, { ...input, ownership: { ...ownership(), principalId: 'attacker' } }]) {
      await expect(daemon.createSandbox({ ...changed, ticket: envelope })).rejects.toThrow();
    }
    await expect(daemon.createSandbox({ ...input, ticket: envelope })).resolves.toBeDefined();
  });
  it('should retain reservations and refuse export until a pending stop becomes quiescent', async () => {
    class PendingAdapter extends FakeRuntimeAdapter {
      exited = false;
      override async stopSandbox(): Promise<boolean> { return this.exited; }
    }
    const adapter = new PendingAdapter();
    const { daemon, admission } = createExecutionNode({ adapter });
    const created = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'pending-create' });
    await daemon.promoteToRunning('sentropic', created.id, { devScope: spec().devScope, commandId: 'pending-run', quotaMiB: 512, uid: 1000, gid: 1000 });
    const first = await daemon.stopSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'pending-stop', stop: { retainOutput: true } });
    expect(first).toMatchObject({ state: 'stopping', allProcessesExited: false });
    expect(admission.reservedMiB('sentropic')).toBe(704);
    await expect(daemon.exportArtifacts('sentropic', created.id, { devScope: spec().devScope, commandId: 'early-export',
      spec: { buildId: 'b', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 1000 } }))
      .rejects.toMatchObject({ code: 'sandbox_not_quiesced' });
    adapter.exited = true;
    await daemon.stopSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'pending-stop-again', stop: { retainOutput: true } });
    expect(created).toMatchObject({ state: 'stopped-output-retained', allProcessesExited: true });
    expect(admission.reservedMiB('sentropic')).toBe(704);
    await expect(daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'replacement' }))
      .rejects.toMatchObject({ status: 429 });
    await daemon.deleteSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'delete-stopped' });
    expect(admission.reservedMiB('sentropic')).toBe(0);
    await expect(daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'replacement' })).resolves.toBeDefined();
  });

  it('should serialize concurrent claims and allow rejected admission to retry', async () => {
    const { daemon } = createExecutionNode();
    const warm = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'warm',
      warmStandby: true, compatibility: compat() });
    const input = { claim: { tenantId: 'sentropic' as const, compatibility: compat(), ownership: ownership() },
      standbyId: warm.id, quotaMiB: 512, uid: 1000, gid: 1000 };
    const first = daemon.claimSandbox({ ...input, devScope: spec().devScope, commandId: 'first' });
    await expect(daemon.claimSandbox({ ...input, devScope: spec().devScope, commandId: 'second' })).rejects.toThrowError(/already_claimed/);
    await first;
    await expect(daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'retry' })).rejects.toMatchObject({ status: 429 });
    await daemon.stopSandbox('sentropic', warm.id, { devScope: spec().devScope, commandId: 'stop-warm', stop: { retainOutput: false } });
    expect((await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'retry' })).state).toBe('creating');
  });
  it('runs creating -> running -> stopping -> stopped-output-retained -> exported -> destroyed', async () => {
    const { daemon, audit } = createExecutionNode();
    const created = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'create-1' });
    expect(created.state).toBe('creating');
    const running = await daemon.promoteToRunning('sentropic', created.id, { devScope: spec().devScope, commandId: 'run-1', quotaMiB: 512, uid: 1000, gid: 1000 });
    expect(running.state).toBe('running');
    const stopped = await daemon.stopSandbox('sentropic', created.id, {
      devScope: spec().devScope, commandId: 'stop-1',
      stop: { retainOutput: true, outputSubPath: 'ui/dist', retentionTtlMs: 300_000 },
    });
    expect(stopped.state).toBe('stopped-output-retained');
    const { bytes, sandbox: exported } = await daemon.exportArtifacts('sentropic', created.id, {
      devScope: spec().devScope, commandId: 'export-1',
      spec: { buildId: 'build-1', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 1_000_000 },
    });
    expect(exported.state).toBe('exported');
    expect(bytes.length).toBeGreaterThan(0);
    const destroyed = await daemon.deleteSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'delete-1' });
    expect(destroyed.state).toBe('destroyed');
    for (const type of ['sandbox.created', 'sandbox.running', 'sandbox.stopped', 'sandbox.exported', 'sandbox.destroyed']) {
      expect(audit.list({ tenantId: 'sentropic' }).some(event => event.type === type)).toBe(true);
    }
    expect(audit.list().every(event => event.tenant_id === 'sentropic')).toBe(true);
  });

  it('rejects export while running and double claim of a claimed box', async () => {
    const { daemon } = createExecutionNode();
    const warm = await daemon.createSandbox({
      spec: spec(), ownership: ownership(), commandId: 'pool-1', warmStandby: true, compatibility: compat(),
    });
    expect(warm.state).toBe('standby');
    const claim: ExecutionNodeClaimSpec = { tenantId: 'sentropic', compatibility: compat(), ownership: ownership() };
    const claimed = await daemon.claimSandbox({ claim, devScope: spec().devScope, commandId: 'claim-1', standbyId: warm.id, quotaMiB: 512, uid: 1000, gid: 1000 });
    expect(claimed.state).toBe('running');
    expect(claimed.poolOwned).toBe(false);
    await expect(
      daemon.claimSandbox({ claim, devScope: spec().devScope, commandId: 'claim-2', standbyId: warm.id, quotaMiB: 512, uid: 1000, gid: 1000 }),
    ).rejects.toThrowError(/already_claimed/);
    await expect(
      daemon.exportArtifacts('sentropic', warm.id, {
        devScope: spec().devScope, commandId: 'export-1',
        spec: { buildId: 'build-1', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 10 },
      }),
    ).rejects.toThrowError(/sandbox_not_quiesced/);
  });

  it('should refuse a replacement after claim and retained stop until DELETE', async () => {
    const { daemon } = createExecutionNode();
    const warm = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'claim-create', warmStandby: true, compatibility: compat() });
    await daemon.claimSandbox({ claim: { tenantId: 'sentropic', ownership: ownership(), compatibility: compat() },
      standbyId: warm.id, devScope: spec().devScope, commandId: 'claim', uid: 1000, gid: 1000, quotaMiB: 704 });
    await daemon.stopSandbox('sentropic', warm.id, { devScope: spec().devScope, commandId: 'retain', stop: { retainOutput: true } });
    const replacement = { spec: spec(), ownership: ownership(), commandId: 'replace-warm', warmStandby: true, compatibility: compat() };
    await expect(daemon.createSandbox(replacement)).rejects.toMatchObject({ status: 429 });
    await daemon.deleteSandbox('sentropic', warm.id, { devScope: spec().devScope, commandId: 'destroy-warm' });
    expect((await daemon.createSandbox(replacement)).state).toBe('standby');
  });

  it('replays the identical command and rejects a mismatched body', async () => {
    const { daemon } = createExecutionNode();
    const first = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'dup-1' });
    const replay = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'dup-1' });
    expect(replay.id).toBe(first.id);
    await expect(
      daemon.createSandbox({ spec: { ...spec(), quotaMiB: 1024 }, ownership: ownership(), commandId: 'dup-1' }),
    ).rejects.toThrowError(/command_id_payload_mismatch/);
  });

  it('fails a running box to failed and destroys it', async () => {
    const { daemon } = createExecutionNode();
    const created = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'f-1' });
    await daemon.promoteToRunning('sentropic', created.id, { devScope: spec().devScope, commandId: 'f-run', quotaMiB: 512, uid: 1000, gid: 1000 });
    expect((await daemon.failSandbox('sentropic', created.id, 'boom')).state).toBe('failed');
    const destroyed = await daemon.deleteSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'f-del' });
    expect(destroyed.state).toBe('destroyed');
    try {
      daemon.renewSandbox('sentropic', created.id, { devScope: spec().devScope, commandId: 'renew' });
      expect.unreachable();
    } catch (error) {
      expect((error as ExecutionNodeError).code).toBe('already_claimed');
    }
  });
  it('should keep build capacity while failed runtime refuses to stop', async () => {
    class HungAdapter extends FakeRuntimeAdapter {
      exited = false;
      override async stopSandbox(): Promise<boolean> { return this.exited; }
      override async destroySandbox(id: string): Promise<void> {
        if (!this.exited) throw new Error('sandbox_not_quiesced');
        return super.destroySandbox(id);
      }
    }
    const adapter = new HungAdapter();
    const { daemon, admission } = createExecutionNode({ adapter });
    const box = await daemon.createSandbox({ spec: { ...spec(), profile: 'artifact-build' }, ownership: ownership(), commandId: 'build' });
    await daemon.promoteToRunning('sentropic', box.id, { devScope: spec().devScope, commandId: 'run', quotaMiB: 1536, uid: 1000, gid: 1000 });
    await daemon.failSandbox('sentropic', box.id, 'failed');
    expect(admission.builds.snapshot().holderTenantId).toBe('sentropic');
    expect(adapter.isLive(box.runtimeId!)).toBe(true);
    await expect(daemon.deleteSandbox('sentropic', box.id, { devScope: spec().devScope, commandId: 'delete' })).rejects.toThrow();
    expect(admission.builds.snapshot().holderTenantId).toBe('sentropic');
    adapter.exited = true;
    await daemon.deleteSandbox('sentropic', box.id, { devScope: spec().devScope, commandId: 'delete' });
    expect(admission.builds.snapshot().holderTenantId).toBeUndefined();
  });
});
