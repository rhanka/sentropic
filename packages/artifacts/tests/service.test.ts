/**
 * L-5a — artifact service wiring: one service for HTTP and MCP.
 *
 * The service composes the tested modules in a fixed order: authorization
 * first (a forged actor creates nothing, not even a binding or an
 * idempotency record), then idempotent execution of the binding ensure.
 * Storage and UUIDs come from injected ports only; there is no implicit
 * in-memory default (callers pass explicit ports, fail-closed).
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createArtifactService } from '../src/server/service.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createRadarKeyDerivation } from '../src/server/command-identity.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import type {
  ArtifactAuthorizationDecision,
  ArtifactCommitContext,
  ArtifactCommitTransaction,
  ArtifactInvocationContext,
  CommitExecutor,
  CommitPolicyParticipantFactory,
  FinalizeConnection,
  StoredCommitReceipt,
} from '../src/server/commit/types.js';
import {
  createGuardedEnsureService,
  type GuardedEnsureHost,
} from '../src/server/service.js';

function makeService() {
  return createArtifactService({ kv: createMemoryKv(), uuid: createCryptoUuid() });
}

const VIEW = {
  ownerId: 'owner-1',
  storageScopeId: 'scope-1',
  bindingName: 'site',
};

describe('artifact service', () => {
  it('creates one private view and replays it', async () => {
    const service = makeService();
    const first = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(first.created).toBe(true);
    expect(first.replayed).toBe(false);
    const second = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.replayed).toBe(true);
  });

  it('creates nothing for a forged actor', async () => {
    const service = makeService();
    await expect(
      service.ensurePrivateView({
        actorUserId: 'owner-2',
        idempotencyKey: 'k-evil',
        paramsHash: 'h-1',
        ...VIEW,
      }),
    ).rejects.toThrow(/access denied/);
    const legit = await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-legit',
      paramsHash: 'h-1',
      ...VIEW,
    });
    expect(legit.created).toBe(true);
  });

  it('surfaces idempotency conflicts', async () => {
    const service = makeService();
    await service.ensurePrivateView({
      actorUserId: 'owner-1',
      idempotencyKey: 'k-1',
      paramsHash: 'h-1',
      ...VIEW,
    });
    await expect(
      service.ensurePrivateView({
        actorUserId: 'owner-1',
        idempotencyKey: 'k-1',
        paramsHash: 'h-1',
        ...VIEW,
        bindingName: 'other',
      }),
    ).rejects.toThrow(/idempotency conflict/);
  });

  it('should isolate identical keys between principals', async () => {
    const service = makeService();
    const ensure = (ownerId: string) => service.ensurePrivateView({
      ...VIEW, ownerId, actorUserId: ownerId, idempotencyKey: 'shared', paramsHash: 'forged',
    });
    const first = await ensure('alice');
    const second = await ensure('bob');
    expect(second.artifactId).not.toBe(first.artifactId);
    expect(second.replayed).toBe(false);
  });

  it('should ignore caller hashes and bind validated parameters', async () => {
    const service = makeService();
    const input = { ...VIEW, actorUserId: VIEW.ownerId, idempotencyKey: 'same', paramsHash: 'a' };
    const first = await service.ensurePrivateView(input);
    expect(await service.ensurePrivateView({ ...input, paramsHash: 'b' }))
      .toMatchObject({ artifactId: first.artifactId, replayed: true });
  });
});

/** L5 — guarded ensure on a memory finalization harness (no DB). */
const ENSURE_SCOPE = 'scope-l5';
const ENSURE_ACTORS = ['alice', 'bob'];

interface GuardedHarness {
  serviceFor(scope: string, actors: readonly string[]): ReturnType<typeof createGuardedEnsureService>;
  service: ReturnType<typeof createGuardedEnsureService>;
  receipts: Map<string, StoredCommitReceipt>;
  bindings: Map<string, { artifactId: string; scope: string; attempt: string }>;
  state: { reserveQuotaCalls: number; resolveBindingCalls: number; locks: string[]; purposes: string[] };
  setApproval(actor: string, approved: boolean): void;
  failNextCommit(error: unknown): void;
  seedLegacy(internalKey: string): void;
  invoke(actor: string, storageScopeId?: string): ArtifactInvocationContext;
  args(bindingName?: string, idempotencyKey?: string): { bindingName: string; idempotencyKey: string };
}

const makeGuardedHarness = (options?: { quotaTotal?: number }): GuardedHarness => {
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, { artifactId: string; scope: string; attempt: string }>();
  const approvals = new Map<string, boolean>([['alice', true], ['bob', true]]);
  const quota = { total: options?.quotaTotal ?? 100, used: 0 };
  const state = { reserveQuotaCalls: 0, resolveBindingCalls: 0, locks: [] as string[], purposes: [] as string[] };
  let commitErrorOnce: unknown;
  let commitErrorArmed = false;
  let invSeq = 0;
  const executor: CommitExecutor = {
    async ensureCoordinationRow(): Promise<void> {},
    async beginFinalization(): Promise<FinalizeConnection> {
      let staged: StoredCommitReceipt | undefined;
      return {
        async query() { return { rows: [], rowCount: 0 }; },
        async beginReadCommitted(): Promise<void> {},
        async lockOperationKey(): Promise<void> {},
        async readReceipt(scope: string, key: string) { return receipts.get(`${scope}/${key}`); },
        async insertReceipt(receipt: StoredCommitReceipt): Promise<void> {
          const mapKey = `${receipt.scopeId}/${receipt.internalKey}`;
          if (receipts.has(mapKey)) throw Object.assign(new Error('duplicate key value'), { code: '23505' });
          staged = receipt;
        },
        async commit(): Promise<void> {
          if (commitErrorArmed) {
            commitErrorArmed = false;
            const error = commitErrorOnce;
            commitErrorOnce = undefined;
            throw error;
          }
          if (staged !== undefined) receipts.set(`${staged.scopeId}/${staged.internalKey}`, staged);
        },
        async rollback(): Promise<void> { staged = undefined; },
        release(): void {},
      };
    },
  };
  const policy: CommitPolicyParticipantFactory = {
    createParticipant: (_client, transactionToken) => ({
      async readRevision() { return 'rev-1'; },
      async checkApproval(input) {
        return approvals.get(input.actorId) === false
          ? { approved: false as const, reason: 'denied' as const }
          : { approved: true as const };
      },
      async reserveQuota() {
        state.reserveQuotaCalls += 1;
        if (quota.used >= quota.total) return { reserved: false };
        quota.used += 1;
        return { reserved: true };
      },
      mintFence: (revision, invocationId) => ({
        fenceId: `fence-${transactionToken}`, transactionId: transactionToken, invocationId, policyRevision: revision,
      }),
    }),
  };
  const guard = async (
    context: ArtifactCommitContext, transaction: ArtifactCommitTransaction,
  ): Promise<ArtifactAuthorizationDecision> => {
    state.purposes.push(context.purpose);
    const revision = await transaction.participant.readRevision();
    if (context.policyRevision !== revision) {
      return { allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false };
    }
    const check = await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation });
    if (!check.approved) {
      return { allowed: false, reason: check.reason ?? 'denied', publicCode: 'access_denied', status: 403, retriable: false };
    }
    return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
  };
  const host: GuardedEnsureHost = {
    async lockBinding(_client, binding) {
      state.locks.push(`${binding.ownerId}/${binding.bindingName}`);
    },
    async resolveBinding(_client, binding) {
      state.resolveBindingCalls += 1;
      const key = `${binding.ownerId}/${binding.bindingName}`;
      const found = bindings.get(key);
      if (found !== undefined) {
        if (found.scope !== binding.storageScopeId) throw new Error(`binding scope mismatch for ${binding.bindingName}`);
        return { artifactId: found.artifactId, created: false };
      }
      const artifactId = randomUUID();
      bindings.set(key, { artifactId, scope: binding.storageScopeId, attempt: binding.attemptId });
      return { artifactId, created: true };
    },
    async abandonAttempt(attemptId) {
      for (const [key, row] of bindings) if (row.attempt === attemptId) bindings.delete(key);
    },
    async readPolicyRevision() { return 'rev-1'; },
  };
  const coordinator = createArtifactCommitCoordinator({ executor, policy });
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const serviceFor = (scope: string, actors: readonly string[]) => createGuardedEnsureService({
    profile,
    coordinator,
    derivation: createRadarKeyDerivation({ storageScopeId: scope, actorIds: [...actors] }),
    host,
  });
  return {
    serviceFor,
    service: serviceFor(ENSURE_SCOPE, ENSURE_ACTORS),
    receipts, bindings, state,
    setApproval: (actor, approved) => { approvals.set(actor, approved); },
    failNextCommit: (error) => { commitErrorOnce = error; commitErrorArmed = true; },
    seedLegacy: (internalKey) => {
      receipts.set(`${ENSURE_SCOPE}/${internalKey}`, {
        scopeId: ENSURE_SCOPE,
        internalKey: internalKey as StoredCommitReceipt['internalKey'],
        commandHash: 'legacy-hash',
        codecVersion: 'artifacts-command/v0',
        receipt: { artifactId: randomUUID(), created: true },
        createdAt: new Date(0).toISOString(),
      });
    },
    invoke: (actor, storageScopeId = ENSURE_SCOPE) => ({
      invocationId: `inv-l5-${(invSeq += 1)}`, actorId: actor, storageScopeId, authorizeCommit: guard,
    }),
    args: (bindingName = 'site', idempotencyKey = 'k-1') => ({ bindingName, idempotencyKey }),
  };
};

describe('guarded ensure', () => {
  it('creates one binding and replays the durable receipt without re-running effects', async () => {
    const harness = makeGuardedHarness();
    const first = await harness.service.ensure(harness.invoke('alice'), harness.args());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toMatchObject({ created: true, replayed: false });
    expect(first.commitState).toBe('committed');
    const second = await harness.service.ensure(harness.invoke('alice'), harness.args());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result).toEqual({ ...first.result, replayed: true });
    expect(harness.state.resolveBindingCalls).toBe(1);
    expect(harness.state.reserveQuotaCalls).toBe(1);
    expect(harness.receipts.size).toBe(1);
  });

  it('denies without a replayable success and retries fresh after re-authorization', async () => {
    const harness = makeGuardedHarness();
    harness.setApproval('alice', false);
    const denied = await harness.service.ensure(harness.invoke('alice'), harness.args('site', 'k-denied'));
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.failure).toMatchObject({
      category: 'unauthorized_at_commit',
      httpStatus: 403,
      publicCode: 'access_denied',
      retriable: false,
      commitState: 'not_committed',
    });
    expect(harness.receipts.size).toBe(0);
    expect(harness.bindings.size).toBe(0);
    harness.setApproval('alice', true);
    const retried = await harness.service.ensure(harness.invoke('alice'), harness.args('site', 'k-denied'));
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.result).toMatchObject({ created: true, replayed: false });
    expect(harness.receipts.size).toBe(1);
  });

  it('conflicts on the same key with a different command without an extra release', async () => {
    const harness = makeGuardedHarness();
    const first = await harness.service.ensure(harness.invoke('alice'), harness.args('site-a', 'k-shared'));
    expect(first.ok).toBe(true);
    const second = await harness.service.ensure(harness.invoke('alice'), harness.args('site-b', 'k-shared'));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure).toMatchObject({
      category: 'conflict',
      httpStatus: 409,
      publicCode: 'conflict',
      retriable: false,
      commitState: 'not_committed',
    });
    expect(harness.receipts.size).toBe(1);
  });

  it('invokes the guard after waits with finalize then replay purposes', async () => {
    const harness = makeGuardedHarness();
    const first = await harness.service.ensure(harness.invoke('alice'), harness.args('observed', 'k-observed'));
    expect(first.ok).toBe(true);
    const second = await harness.service.ensure(harness.invoke('alice'), harness.args('observed', 'k-observed'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.replayed).toBe(true);
    expect(harness.state.purposes).toContain('finalize');
    expect(harness.state.purposes).toContain('replay');
    expect(harness.state.locks).toEqual(['alice/observed', 'alice/observed']);
  });
});
