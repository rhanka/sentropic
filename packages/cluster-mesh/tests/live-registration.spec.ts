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
    find: vi.fn(async (tenant: string, declarationId: string, cloneId: string, worktreeId: string) => {
      return (rows.get(tripleKey(tenant, declarationId, cloneId, worktreeId))?.declaration as never) ?? null;
    }),
    list: vi.fn(async (tenant?) => [...rows.values()]
      .filter((row) => row.status === 'declared' && (tenant === undefined || row.declaration.tenant === tenant))
      .map((row) => row.declaration as never)),
    status: vi.fn(async (tenant: string, declarationId: string, cloneId: string, worktreeId: string) => {
      return (rows.get(tripleKey(tenant, declarationId, cloneId, worktreeId))?.status as 'declared' | 'withdrawn') ?? 'unknown';
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
    const { store, rows, tripleKey } = memoryStore();
    const work = deferredWorkFake(3);
    const purge = purgeFake();
    const live = registration(store, work, purge.port);
    const id = sampleIdentity('host-b', 'gamma');
    await live.declare({
      tenant: 'tenant-b',
      principal: 'principal-2',
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      identityUncertainty: id.identityUncertainty,
      hostFingerprint: 'ws:sha256:bbb',
      authorizedRoots: ['/repos/gamma'],
      policyVersion: 'live-git-indexing/1',
    });
    const removal = await live.withdraw({
      tenant: 'tenant-b',
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      reason: 'workspace-remove',
      withdrawnAt: '2026-10-12T13:00:00.000Z',
    });
    expect(removal).toMatchObject({
      ok: true,
      cancelledDeferredWork: 3,
      withdrawal: {
        tenant: 'tenant-b',
        declarationId: id.declarationId,
        cloneId: id.cloneId,
        worktreeId: id.worktreeId,
        declarationRevision: INITIAL_DECLARATION_REVISION,
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
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      declarationRevision: INITIAL_DECLARATION_REVISION,
    });
    expect(purge.received).toHaveLength(1);
    expect(purge.received[0].requestPrivatePurge.preserveCommittedHistory).toBe(true);
    // Committed history is preserved: the durable record is retained, only its status changes.
    await expect(live.status('tenant-b', id.declarationId, id.cloneId, id.worktreeId)).resolves.toBe('withdrawn');
    expect(rows.get(tripleKey('tenant-b', id.declarationId, id.cloneId, id.worktreeId))).toBeDefined();
    // Removal is final: no delayed-work reactivation after withdrawal.
    await expect(live.withdraw({
      tenant: 'tenant-b',
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      reason: 'owner-request',
      withdrawnAt: '2026-10-12T13:01:00.000Z',
    })).resolves.toMatchObject({ ok: false, reason: 'unknown_declaration' });
    expect(work.cancelDeferredWork).toHaveBeenCalledTimes(1);

    // If recordWithdrawal fails (e.g. concurrent race), store fails durable record first: no cancel and no purge
    const idRace = sampleIdentity('host-b', 'race');
    await live.declare({
      tenant: 'tenant-b',
      principal: 'principal-race',
      declarationId: idRace.declarationId,
      cloneId: idRace.cloneId,
      worktreeId: idRace.worktreeId,
      identityUncertainty: idRace.identityUncertainty,
      hostFingerprint: 'ws:race',
      authorizedRoots: ['/repos/race'],
      policyVersion: 'live-git-indexing/1',
    });
    const workRace = deferredWorkFake(2);
    const purgeRace = purgeFake();
    const storeRace: LiveDeclarationStorePort = {
      ...store,
      recordWithdrawal: vi.fn(async () => false),
    };
    const liveRace = createLiveDeclarationRegistration({ store: storeRace, deferredWork: workRace, privatePurge: purgeRace.port });
    await expect(liveRace.withdraw({
      tenant: 'tenant-b',
      declarationId: idRace.declarationId,
      cloneId: idRace.cloneId,
      worktreeId: idRace.worktreeId,
      reason: 'owner-request',
      withdrawnAt: '2026-10-12T13:03:00.000Z',
    })).resolves.toMatchObject({ ok: false, reason: 'unknown_declaration' });
    expect(workRace.cancelDeferredWork).not.toHaveBeenCalled();
    expect(purgeRace.received).toHaveLength(0);
  });

  it('product declarations use authorized code-workspace bindings without changing membership or enrollment', async () => {
    const { store, calls } = memoryStore();
    const live = registration(store, deferredWorkFake(0), purgeFake().port);
    const idC = sampleIdentity('host-c', 'delta');
    const product = await live.declare({
      tenant: 'tenant-c',
      principal: 'principal-3',
      declarationId: idC.declarationId,
      cloneId: idC.cloneId,
      worktreeId: idC.worktreeId,
      identityUncertainty: idC.identityUncertainty,
      hostFingerprint: 'ws:sha256:ccc',
      authorizedRoots: ['/repos/delta'],
      policyVersion: 'live-git-indexing/1',
      serverWorkspaceId: 'ws-7',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    expect(product).toMatchObject({
      serverWorkspaceId: 'ws-7',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    // Non-binding revision preserves bindingRevision
    const nonBindingRevised = await live.revise(
      'tenant-c',
      idC.declarationId,
      { authorizedRoots: ['/repos/delta', '/repos/delta-2'] },
      idC.cloneId,
      idC.worktreeId,
    );
    expect(nonBindingRevised.bindingRevision).toBe(INITIAL_BINDING_REVISION);
    expect(nonBindingRevised.declarationRevision).toBe(INITIAL_DECLARATION_REVISION + 1);

    // Workspace change requires strictly increasing bindingRevision
    const workspaceRevised = await live.revise(
      'tenant-c',
      idC.declarationId,
      {
        serverWorkspaceId: 'ws-8',
        serverIssuer: 'https://idp.example',
        bindingRevision: INITIAL_BINDING_REVISION + 1,
      },
      idC.cloneId,
      idC.worktreeId,
    );
    expect(workspaceRevised.serverWorkspaceId).toBe('ws-8');
    expect(workspaceRevised.bindingRevision).toBe(INITIAL_BINDING_REVISION + 1);
    expect(workspaceRevised.declarationRevision).toBe(INITIAL_DECLARATION_REVISION + 2);

    // An authorized code-workspace binding is a coherent trio; partial bindings are refused.
    const idD = sampleIdentity('host-d', 'epsilon');
    await expect(live.declare({
      tenant: 'tenant-d',
      principal: 'principal-4',
      declarationId: idD.declarationId,
      cloneId: idD.cloneId,
      worktreeId: idD.worktreeId,
      identityUncertainty: idD.identityUncertainty,
      authorizedRoots: ['/repos/epsilon'],
      policyVersion: 'live-git-indexing/1',
      serverWorkspaceId: 'ws-8',
    })).rejects.toThrow(/bindingRevision/);

    const idE = sampleIdentity('host-e', 'zeta');
    await expect(live.declare({
      tenant: 'tenant-e',
      principal: 'principal-5',
      declarationId: idE.declarationId,
      cloneId: idE.cloneId,
      worktreeId: idE.worktreeId,
      identityUncertainty: idE.identityUncertainty,
      authorizedRoots: ['/repos/zeta'],
      policyVersion: 'live-git-indexing/1',
      serverIssuer: 'https://idp.example',
    })).rejects.toThrow(/serverWorkspaceId/);

    // Bind, upload, code-workspace creation and session open/end never activate or remove.
    for (const kind of NON_ACTIVATING_LIFECYCLE_KINDS) {
      expect(classifyLifecycleEvent(kind)).toBe('no-activation-change');
    }
    expect(() => classifyLifecycleEvent('declare-live' as never)).toThrow(/unknown lifecycle kind/);
    // No membership or enrollment seam exists: the domain is declaration-only.
    expect(Object.keys(live).sort()).toEqual(['declare', 'list', 'replay', 'revise', 'status', 'withdraw']);
    expect(calls).toEqual(['save', 'save', 'save']);
  });

  it('enforces monotonic binding revisions, revalidation and initial binding rules', async () => {
    const { store } = memoryStore();
    const live = registration(store, deferredWorkFake(0), purgeFake().port);
    const id = sampleIdentity('host-m3', 'repo-m3');
    await live.declare({
      tenant: 'tenant-m3',
      principal: 'principal-m3',
      declarationId: id.declarationId,
      cloneId: id.cloneId,
      worktreeId: id.worktreeId,
      identityUncertainty: id.identityUncertainty,
      hostFingerprint: 'ws:m3',
      authorizedRoots: ['/repos/m3'],
      policyVersion: 'live-git-indexing/1',
      serverWorkspaceId: 'ws-m3',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });

    // Refusal of equal or lower bindingRevision
    await expect(live.revise(
      'tenant-m3',
      id.declarationId,
      { bindingRevision: INITIAL_BINDING_REVISION },
      id.cloneId,
      id.worktreeId,
    )).rejects.toThrow(/monotonic/);

    // Changing issuer alone requires fresh strictly increasing bindingRevision
    await expect(live.revise(
      'tenant-m3',
      id.declarationId,
      { serverIssuer: 'https://idp-2.example' },
      id.cloneId,
      id.worktreeId,
    )).rejects.toThrow(/strictly increasing bindingRevision/);

    const issuerRevised = await live.revise(
      'tenant-m3',
      id.declarationId,
      {
        serverIssuer: 'https://idp-2.example',
        bindingRevision: INITIAL_BINDING_REVISION + 1,
      },
      id.cloneId,
      id.worktreeId,
    );
    expect(issuerRevised.serverIssuer).toBe('https://idp-2.example');
    expect(issuerRevised.bindingRevision).toBe(INITIAL_BINDING_REVISION + 1);

    // Explicit revalidation
    const revalidated = await live.revise(
      'tenant-m3',
      id.declarationId,
      { bindingRevision: INITIAL_BINDING_REVISION + 2 },
      id.cloneId,
      id.worktreeId,
    );
    expect(revalidated.bindingRevision).toBe(INITIAL_BINDING_REVISION + 2);

    // Local-only declaration transitioning to product binding requires bindingRevision === INITIAL_BINDING_REVISION (1)
    const localId = sampleIdentity('host-m3', 'local-repo');
    await live.declare({
      tenant: 'tenant-m3',
      principal: 'principal-local',
      declarationId: localId.declarationId,
      cloneId: localId.cloneId,
      worktreeId: localId.worktreeId,
      identityUncertainty: localId.identityUncertainty,
      hostFingerprint: 'ws:local',
      authorizedRoots: ['/repos/local'],
      policyVersion: 'live-git-indexing/1',
    });
    await expect(live.revise(
      'tenant-m3',
      localId.declarationId,
      {
        serverWorkspaceId: 'ws-local',
        serverIssuer: 'https://idp.example',
        bindingRevision: 2,
      },
      localId.cloneId,
      localId.worktreeId,
    )).rejects.toThrow(/first product binding to carry bindingRevision 1/);

    const firstBound = await live.revise(
      'tenant-m3',
      localId.declarationId,
      {
        serverWorkspaceId: 'ws-local',
        serverIssuer: 'https://idp.example',
        bindingRevision: INITIAL_BINDING_REVISION,
      },
      localId.cloneId,
      localId.worktreeId,
    );
    expect(firstBound.bindingRevision).toBe(INITIAL_BINDING_REVISION);
  });

  it('mirrors canonical identity derivations with exact golden parity', () => {
    const clone = deriveCloneIdentity({
      hostScope: 'host:a',
      commonDirRealpath: '/srv/repo/.git',
      commonDirProjectFingerprint: 'proj-fingerprint-9f',
      identityUncertainty: [],
      oidAlgorithm: 'sha1',
    });
    expect(clone.cloneId).toBe('clone:c5bd6c412ce05e16d45a5504240903d27e65c11c94d30f8fb82ff648056443ed');
    const worktree = deriveWorktreeIdentity({
      hostScope: 'host:a',
      clone,
      worktreePath: '/work/repo',
      gitDir: '/srv/repo/.git',
      worktreeFingerprint: 'ws:abc123',
      identityUncertainty: [],
    });
    expect(worktree.worktreeId).toBe('wt:3aea1f8cbce8363e2168b4422b9fde11aec8e984eec828236d08c8842a46e5a8');
    const declaration = deriveDeclarationIdentity({ hostScope: 'host:a', clone, worktree });
    expect(declaration.declarationId).toBe('decl:8a1205250845002fd2a8326d3514a5c6ce0b19d1d44e81641d1a3752b112f3b5');
  });
});
