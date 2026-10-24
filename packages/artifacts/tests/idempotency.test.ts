/**
 * L-5a — operation idempotency: one result per key, explicit conflicts.
 *
 * Repeating a request with the same idempotency key and the same parameter
 * hash returns the stored result without re-executing (replayed=true).
 * Reusing a key with different parameters is an explicit conflict, never a
 * silent overwrite. Different keys are independent. Retry keys live outside
 * manifests and never corrupt semantic deduplication.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
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

describe('operation idempotency', () => {
  it('executes once and replays the stored result', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { artifactId: 'new-uuid' };
    };
    const first = await store.execute('key-1', 'hash-a', work);
    const second = await store.execute('key-1', 'hash-a', work);
    const third = await store.execute('key-1', 'hash-a', work);
    expect(calls).toBe(1);
    expect(first).toEqual({ result: { artifactId: 'new-uuid' }, replayed: false });
    expect(second).toEqual({ result: { artifactId: 'new-uuid' }, replayed: true });
    expect(third.replayed).toBe(true);
  });

  it('refuses key reuse with different parameters', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    await store.execute('key-1', 'hash-a', async () => ({ ok: true }));
    await expect(store.execute('key-1', 'hash-b', async () => ({ ok: true }))).rejects.toThrow(
      /idempotency conflict/,
    );
  });

  it('keeps different keys independent', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };
    await store.execute('key-1', 'hash-a', work);
    const other = await store.execute('key-2', 'hash-a', work);
    expect(calls).toBe(2);
    expect(other).toEqual({ result: 2, replayed: false });
  });
});

/** L5 — durable-key idempotency for the guarded ensure path (spec r2 A7). */
const IDEMPOTENCY_SCOPE = 'scope-l5-idem';

const makeIdempotencyHarness = () => {
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, { artifactId: string; attempt: string }>();
  let approved = true;
  let invSeq = 0;
  const state = { resolveBindingCalls: 0 };
  const executor: CommitExecutor = {
    async ensureCoordinationRow(): Promise<void> {},
    async beginFinalization(): Promise<FinalizeConnection> {
      let staged: StoredCommitReceipt | undefined;
      return {
        async query() { return { rows: [], rowCount: 0 }; },
        async beginReadCommitted(): Promise<void> {},
        async lockOperationKey(): Promise<void> {},
        async readReceipt(scope: string, key: string) { return receipts.get(`${scope}/${key}`); },
        async insertReceipt(receipt: StoredCommitReceipt): Promise<void> { staged = receipt; },
        async commit(): Promise<void> {
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
      async checkApproval() {
        return approved ? { approved: true as const } : { approved: false as const, reason: 'denied' as const };
      },
      async reserveQuota() { return { reserved: true }; },
      mintFence: (revision, invocationId) => ({
        fenceId: `fence-${transactionToken}`, transactionId: transactionToken, invocationId, policyRevision: revision,
      }),
    }),
  };
  const guard = async (
    context: ArtifactCommitContext, transaction: ArtifactCommitTransaction,
  ): Promise<ArtifactAuthorizationDecision> => {
    const revision = await transaction.participant.readRevision();
    const check = await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation });
    if (context.policyRevision !== revision || !check.approved) {
      return { allowed: false, reason: 'denied', publicCode: 'access_denied', status: 403, retriable: false };
    }
    return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
  };
  const host: GuardedEnsureHost = {
    async lockBinding(): Promise<void> {},
    async resolveBinding(_client, binding) {
      state.resolveBindingCalls += 1;
      const found = bindings.get(binding.bindingName);
      if (found !== undefined) return { artifactId: found.artifactId, created: false };
      const artifactId = randomUUID();
      bindings.set(binding.bindingName, { artifactId, attempt: binding.attemptId });
      return { artifactId, created: true };
    },
    async abandonAttempt(attemptId) {
      for (const [key, row] of bindings) if (row.attempt === attemptId) bindings.delete(key);
    },
    async readPolicyRevision() { return 'rev-1'; },
  };
  const service = createGuardedEnsureService({
    profile: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
    coordinator: createArtifactCommitCoordinator({ executor, policy }),
    derivation: createRadarKeyDerivation({ storageScopeId: IDEMPOTENCY_SCOPE, actorIds: ['alice'] }),
    host,
  });
  const invoke = (): ArtifactInvocationContext => ({
    invocationId: `inv-idem-${(invSeq += 1)}`, actorId: 'alice', storageScopeId: IDEMPOTENCY_SCOPE, authorizeCommit: guard,
  });
  return {
    service, receipts, bindings, state, invoke,
    setApproved: (value: boolean) => { approved = value; },
    args: { bindingName: 'site', idempotencyKey: 'k-idem' },
  };
};

describe('guarded ensure durable keys', () => {
  it('never returns a receipt from a refused attempt and retries fresh on the same key', async () => {
    const harness = makeIdempotencyHarness();
    harness.setApproved(false);
    const denied = await harness.service.ensure(harness.invoke(), harness.args);
    expect(denied.ok).toBe(false);
    harness.setApproved(true);
    const retried = await harness.service.ensure(harness.invoke(), harness.args);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.result).toMatchObject({ created: true, replayed: false });
    expect(harness.receipts.size).toBe(1);
    expect(harness.bindings.size).toBe(1);
  });

  it('replays a genuine success only while currently authorized', async () => {
    const harness = makeIdempotencyHarness();
    const first = await harness.service.ensure(harness.invoke(), harness.args);
    expect(first.ok).toBe(true);
    harness.setApproved(false);
    const revoked = await harness.service.ensure(harness.invoke(), harness.args);
    expect(revoked.ok).toBe(false);
    if (revoked.ok) return;
    expect(revoked.failure).toMatchObject({
      category: 'unauthorized_at_commit', httpStatus: 403, commitState: 'not_committed',
    });
    harness.setApproved(true);
    const replayed = await harness.service.ensure(harness.invoke(), harness.args);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok || !first.ok) return;
    expect(replayed.result).toEqual({ ...first.result, replayed: true });
    expect(harness.state.resolveBindingCalls).toBe(1);
  });
});
