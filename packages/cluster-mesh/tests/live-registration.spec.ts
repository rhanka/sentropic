import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_BINDING_REVISION,
  INITIAL_DECLARATION_REVISION,
  NON_ACTIVATING_LIFECYCLE_KINDS,
  classifyLifecycleEvent,
  createLiveDeclarationRegistration,
  deriveCloneIdentity,
  deriveDeclarationIdentity,
  deriveWorktreeIdentity,
  type LiveDeclarationReplaySink,
  type LiveDeclarationStorePort,
  type LiveDeclarationWithdrawal,
  type LiveDeferredWorkPort,
  type LivePrivatePurgePort,
} from '../src/live-storage/registration.js';

// In-memory durable store fake: withdrawal marks the row but never deletes it.
function memoryStore() {
  const rows = new Map<string, { declaration: Record<string, unknown>; status: string }>();
  const calls: string[] = [];
  const tripleKey = (tenant: string, declarationId: string, cloneId: string, worktreeId: string) =>
    `${tenant}\0${declarationId}\0${cloneId}\0${worktreeId}`;
  const store: LiveDeclarationStorePort = {
    save: vi.fn(async (declaration) => {
      calls.push('save');
      rows.set(tripleKey(declaration.tenant, declaration.declarationId, declaration.cloneId, declaration.worktreeId), {
        declaration: { ...declaration },
        status: 'declared',
      });
    }),
    find: vi.fn(async (tenant, declarationId, cloneId, worktreeId) => {
      if (cloneId && worktreeId) {
        return (rows.get(tripleKey(tenant, declarationId, cloneId, worktreeId))?.declaration as never) ?? null;
      }
      for (const row of rows.values()) {
        if (row.declaration.tenant === tenant && row.declaration.declarationId === declarationId) {
          return row.declaration as never;
        }
      }
      return null;
    }),
    list: vi.fn(async (tenant?) => [...rows.values()]
      .filter((row) => row.status === 'declared' && (tenant === undefined || row.declaration.tenant === tenant))
      .map((row) => row.declaration as never)),
    status: vi.fn(async (tenant, declarationId, cloneId, worktreeId) => {
      if (cloneId && worktreeId) {
        return (rows.get(tripleKey(tenant, declarationId, cloneId, worktreeId))?.status as 'declared' | 'withdrawn') ?? 'unknown';
      }
      for (const row of rows.values()) {
        if (row.declaration.tenant === tenant && row.declaration.declarationId === declarationId) {
          return row.status as 'declared' | 'withdrawn';
        }
      }
      return 'unknown';
    }),
    recordWithdrawal: vi.fn(async (withdrawal: LiveDeclarationWithdrawal) => {
      const row = rows.get(tripleKey(withdrawal.tenant, withdrawal.declarationId, withdrawal.cloneId, withdrawal.worktreeId));
      if (!row || row.status !== 'declared') return false;
      row.status = 'withdrawn';
      return true;
    }),
  };
  return { store, rows, calls, tripleKey };
}

function deferredWorkFake(pending: number) {
  const port: LiveDeferredWorkPort = {
    cancelDeferredWork: vi.fn(async () => {
      const cancelled = pending;
      pending = 0;
      return cancelled;
    }),
  };
  return port;
}

function purgeFake() {
  const received: LiveDeclarationWithdrawal[] = [];
  const port: LivePrivatePurgePort = {
    requestPrivatePurge: vi.fn(async (withdrawal) => {
      received.push(withdrawal);
    }),
  };
  return { port, received };
}

function registration(store: LiveDeclarationStorePort, work: LiveDeferredWorkPort, purge: LivePrivatePurgePort) {
  return createLiveDeclarationRegistration({ store, deferredWork: work, privatePurge: purge });
}

function sampleIdentity(hostScope: string, repo: string) {
  const clone = deriveCloneIdentity({
    hostScope,
    commonDirRealpath: `/repos/${repo}`,
    commonDirProjectFingerprint: `proj:${repo}:root`,
    oidAlgorithm: 'sha1',
  });
  const worktree = deriveWorktreeIdentity({
    clone,
    hostScope,
    worktreePath: `/repos/${repo}`,
    gitDir: `/repos/${repo}/.git`,
    worktreeFingerprint: `wt:${repo}:head`,
  });
  const decl = deriveDeclarationIdentity({
    hostScope,
    clone,
    worktree,
  });
  return {
    ...decl,
    identityUncertainty: [...clone.identityUncertainty, ...worktree.identityUncertainty],
  };
}

describe('live registration', () => {
  it('declarations bind canonical identity derivation and revision and replay after projection loss', async () => {
    const { store, calls } = memoryStore();
    const live = registration(store, deferredWorkFake(0), purgeFake().port);
    const id = sampleIdentity('host-a', 'alpha');
    const declared = await live.declare({
      tenant: 'tenant-a',
      principal: 'principal-1',
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      identityUncertainty: id.identityUncertainty,
      hostFingerprint: 'ws:sha256:aaa',
      authorizedRoots: ['/repos/alpha'],
      policyVersion: 'live-git-indexing/1',
    });
    expect(declared).toMatchObject({
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      declarationRevision: INITIAL_DECLARATION_REVISION,
    });
    const revised = await live.revise(
      'tenant-a',
      id.declarationId,
      { authorizedRoots: ['/repos/alpha', '/repos/beta'] },
      id.cloneId,
      id.worktreeId,
    );
    expect(revised).toMatchObject({
      tenant: 'tenant-a',
      principal: 'principal-1',
      declarationId: id.declarationId,
      declarationRevision: INITIAL_DECLARATION_REVISION + 1,
    });
    await expect(store.find('tenant-a', id.declarationId, id.cloneId, id.worktreeId)).resolves.toMatchObject({
      declarationId: id.declarationId,
      declarationRevision: INITIAL_DECLARATION_REVISION + 1,
    });
    // Projection loss: the previous sink is replaced; replay needs no renewed activation.
    const lostSink: LiveDeclarationReplaySink = { replayDeclaration: vi.fn(async () => undefined) };
    await live.replay(lostSink);
    const replacement: LiveDeclarationReplaySink = { replayDeclaration: vi.fn(async () => undefined) };
    await expect(live.replay(replacement)).resolves.toBe(1);
    expect(replacement.replayDeclaration).toHaveBeenCalledWith(expect.objectContaining({
      declarationId: id.declarationId,
      declarationRevision: INITIAL_DECLARATION_REVISION + 1,
    }));
    expect(lostSink.replayDeclaration).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['save', 'save']);
  });

  it('removal cancels delayed work and requests private purge without deleting committed history', async () => {
    const { store, rows } = memoryStore();
    const work = deferredWorkFake(3);
    const purge = purgeFake();
    const live = registration(store, work, purge.port);
    await live.declare({
      tenant: 'tenant-b',
      principal: 'principal-2',
      hostFingerprint: 'ws:sha256:bbb',
      authorizedRoots: ['/repos/gamma'],
      policyVersion: 'live-git-indexing/1',
    });
    const removal = await live.withdraw({
      tenant: 'tenant-b',
      hostFingerprint: 'ws:sha256:bbb',
      reason: 'workspace-remove',
      withdrawnAt: '2026-10-12T13:00:00.000Z',
    });
    expect(removal).toMatchObject({
      ok: true,
      cancelledDeferredWork: 3,
      withdrawal: {
        tenant: 'tenant-b',
        hostFingerprint: 'ws:sha256:bbb',
        declarationRevision: 0,
        reason: 'workspace-remove',
        requestPrivatePurge: {
          purgePrivateSnapshots: true,
          purgeDerivedIndexes: true,
          revokeDecryptability: true,
          preserveCommittedHistory: true,
        },
      },
    });
    expect(work.cancelDeferredWork).toHaveBeenCalledWith({
      tenant: 'tenant-b',
      hostFingerprint: 'ws:sha256:bbb',
      declarationRevision: 0,
    });
    expect(purge.received).toHaveLength(1);
    expect(purge.received[0].requestPrivatePurge.preserveCommittedHistory).toBe(true);
    // Committed history is preserved: the durable record is retained, only its status changes.
    await expect(live.status('tenant-b', 'ws:sha256:bbb')).resolves.toBe('withdrawn');
    expect(rows.get('tenant-b\0ws:sha256:bbb')).toBeDefined();
    // Removal is final: no delayed-work reactivation after withdrawal.
    await expect(live.withdraw({
      tenant: 'tenant-b',
      hostFingerprint: 'ws:sha256:bbb',
      reason: 'owner-request',
      withdrawnAt: '2026-10-12T13:01:00.000Z',
    })).resolves.toMatchObject({ ok: false, reason: 'unknown_declaration' });
    expect(work.cancelDeferredWork).toHaveBeenCalledTimes(1);
  });

  it('product declarations use authorized code-workspace bindings without changing membership or enrollment', async () => {
    const { store, calls } = memoryStore();
    const live = registration(store, deferredWorkFake(0), purgeFake().port);
    const product = await live.declare({
      tenant: 'tenant-c',
      principal: 'principal-3',
      hostFingerprint: 'ws:sha256:ccc',
      authorizedRoots: ['/repos/delta'],
      policyVersion: 'live-git-indexing/1',
      serverWorkspaceId: 'ws-7',
      serverIssuer: 'https://idp.example',
      bindingRevision: 4,
    });
    expect(product).toMatchObject({ serverWorkspaceId: 'ws-7', serverIssuer: 'https://idp.example', bindingRevision: 4 });
    // An authorized code-workspace binding is a coherent trio; partial bindings are refused.
    await expect(live.declare({
      tenant: 'tenant-d',
      principal: 'principal-4',
      hostFingerprint: 'ws:sha256:ddd',
      authorizedRoots: ['/repos/epsilon'],
      policyVersion: 'live-git-indexing/1',
      serverWorkspaceId: 'ws-8',
    })).rejects.toThrow(/bindingRevision/);
    await expect(live.declare({
      tenant: 'tenant-e',
      principal: 'principal-5',
      hostFingerprint: 'ws:sha256:eee',
      authorizedRoots: ['/repos/zeta'],
      policyVersion: 'live-git-indexing/1',
      serverIssuer: 'https://idp.example',
    })).rejects.toThrow(/serverWorkspaceId/);
    // Bind, upload, code-workspace creation and session open/end never activate or remove.
    for (const kind of NON_ACTIVATING_LIFECYCLE_KINDS) {
      expect(classifyLifecycleEvent(kind)).toBe('no-activation-change');
    }
    expect(() => classifyLifecycleEvent('declare-live')).toThrow(/unknown lifecycle kind/);
    // No membership or enrollment seam exists: the domain is declaration-only.
    expect(Object.keys(live).sort()).toEqual(['declare', 'list', 'replay', 'revise', 'status', 'withdraw']);
    expect(calls).toEqual(['save']);
  });
});
