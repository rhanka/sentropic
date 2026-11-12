import { describe, expect, it } from 'vitest';
import type {
  ExecutionNodeClaimSpec,
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
} from '../src/index.js';
import { createExecutionNode, ExecutionNodeError } from '../src/index.js';

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
    tenantId: 'sentropic',
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
  it('runs creating -> running -> stopping -> stopped-output-retained -> exported -> destroyed', async () => {
    const { daemon, audit } = createExecutionNode();
    const created = await daemon.createSandbox({ spec: spec(), ownership: ownership(), commandId: 'create-1' });
    expect(created.state).toBe('creating');
    const running = await daemon.promoteToRunning('sentropic', created.id, { commandId: 'run-1', quotaMiB: 512, uid: 1000, gid: 1000 });
    expect(running.state).toBe('running');
    const stopped = await daemon.stopSandbox('sentropic', created.id, {
      commandId: 'stop-1',
      stop: { retainOutput: true, outputSubPath: 'ui/dist', retentionTtlMs: 300_000 },
    });
    expect(stopped.state).toBe('stopped-output-retained');
    const { bytes, sandbox: exported } = await daemon.exportArtifacts('sentropic', created.id, {
      commandId: 'export-1',
      spec: { buildId: 'build-1', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 1_000_000 },
    });
    expect(exported.state).toBe('exported');
    expect(bytes.length).toBeGreaterThan(0);
    const destroyed = await daemon.deleteSandbox('sentropic', created.id, { commandId: 'delete-1' });
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
    const claimed = await daemon.claimSandbox({ claim, commandId: 'claim-1', standbyId: warm.id, quotaMiB: 512, uid: 1000, gid: 1000 });
    expect(claimed.state).toBe('running');
    expect(claimed.poolOwned).toBe(false);
    await expect(
      daemon.claimSandbox({ claim, commandId: 'claim-2', standbyId: warm.id, quotaMiB: 512, uid: 1000, gid: 1000 }),
    ).rejects.toThrowError(/already_claimed/);
    await expect(
      daemon.exportArtifacts('sentropic', warm.id, {
        commandId: 'export-1',
        spec: { buildId: 'build-1', subPath: 'ui/dist', presignedPutUrl: 'https://s3.example/put', maxBytes: 10 },
      }),
    ).rejects.toThrowError(/sandbox_still_running/);
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
    await daemon.promoteToRunning('sentropic', created.id, { commandId: 'f-run', quotaMiB: 512, uid: 1000, gid: 1000 });
    expect(daemon.failSandbox('sentropic', created.id, 'boom').state).toBe('failed');
    const destroyed = await daemon.deleteSandbox('sentropic', created.id, { commandId: 'f-del' });
    expect(destroyed.state).toBe('destroyed');
    try {
      daemon.renewSandbox('sentropic', created.id);
      expect.unreachable();
    } catch (error) {
      expect((error as ExecutionNodeError).code).toBe('already_claimed');
    }
  });
});
