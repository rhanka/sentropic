/**
 * U1 — one parameterized adapter conformance suite, run against BOTH the
 * Postgres adapters and the SQLite adapters so behaviour parity is proven,
 * not asserted. Covers: bindings, object intents, preparation-intent cleanup
 * reads, idempotency, ACL, sources, lifecycle, publication state with the
 * 0.2.6 CAS, refcounts/pins, the commit coordinator (executor seam plus the
 * real coordinator), restart durability, concurrent writers and the blob
 * store.
 *
 * Backends supply handles; this file owns no driver. Participant SQL uses
 * $N placeholders only (the SQLite FinalizeTxClient normalizes them), plain
 * INSERT/SELECT/UPDATE and no pg-only functions, so one suite serves both.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { JsonValue } from '../../src/contracts.js';
import type { AclStore } from '../../src/server/access.js';
import type { RefcountStore } from '../../src/server/gc.js';
import type { IdempotencyStore } from '../../src/server/idempotency.js';
import type { LifecycleStore } from '../../src/server/lifecycle.js';
import type { PreparationIntentStore } from '../../src/server/object-intents.js';
import type { PublicationBlobStore, PublicationStateStore, ReleaseRecord } from '../../src/server/publication.js';
import type { SourceStore } from '../../src/server/sources.js';
import type {
  ArtifactCommitContext,
  ArtifactCommitTransaction,
  ArtifactAuthorizationDecision,
  ArtifactPolicyDriver,
  CommitExecutor,
  CommitPolicyParticipantFactory,
  FinalizeConnection,
  FinalizeRequest,
  FinalizeTxClient,
  InternalIdempotencyKey,
} from '../../src/server/commit/types.js';
import type { ManagementUnit } from '../../src/server/management.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';

/** Structural shape shared by PostgresArtifactStore and SqliteArtifactStore. */
export interface ArtifactStoreShape
  extends PreparationIntentStore, PublicationStateStore, IdempotencyStore, AclStore, SourceStore, LifecycleStore, RefcountStore {
  ensureArtifact(input: {
    storageScopeId: string; ownerId: string; bindingName: string;
    profile: Record<string, JsonValue | undefined>;
  }): Promise<{ artifactId: string; created: boolean }>;
  listRegisteredBlobs(storageScopeId: string): Promise<string[]>;
}

export interface BlobBackend {
  readonly blobs: PublicationBlobStore;
  /** True when the backend verifies the sha256 digest of stored bytes. */
  readonly verifiesDigest: boolean;
  cleanup(): Promise<void>;
}

export interface ConformanceHandle {
  readonly store: ArtifactStoreShape;
  readonly executor: CommitExecutor;
  /** Management unit bound to a live finalization connection (same as the pg unit factory). */
  makeUnit(conn: FinalizeConnection): ManagementUnit;
  makeBlobStore(): Promise<BlobBackend>;
  /** Create the commit_test namespace with the shared participant tables. */
  setupCommitTest(): Promise<void>;
  /** Count rows of a commit_test table (portable SQL, $N params). */
  countCommitTest(table: 'effects' | 'quotas', where?: string, params?: unknown[]): Promise<number>;
  /** Count coordinator rows directly (schema-qualified names differ per backend). */
  countOperationKeys(scopeId: string, internalKey: string): Promise<number>;
  countReceipts(scopeId: string, internalKey: string): Promise<number>;
  /** Reopen the same durable location (restart durability). */
  reopen(): Promise<ConformanceHandle>;
  close(): Promise<void>;
}

export interface ConformanceBackend {
  readonly name: string;
  open(): Promise<ConformanceHandle>;
}

const SCOPE = 'scope-1';

let keySeq = 0;
const freshKey = (): InternalIdempotencyKey => `conf-${(keySeq += 1)}` as InternalIdempotencyKey;

const release = (artifactId: string, id: string, digest = 'ab'.repeat(32), manifest = '{"schemaVersion":"artifacts/v1","files":[]}'): ReleaseRecord => ({
  releaseId: id, artifactId, manifestDigest: digest, manifest, state: 'ready', createdAt: new Date().toISOString(),
});

export function runStoreConformance(backend: ConformanceBackend): void {
  describe(`${backend.name} store conformance`, () => {
    it('ensures stable bindings, converges concurrent ensures and refuses terminal ones', async () => {
      const h = await backend.open();
      try {
        const a = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-1', bindingName: 'site', profile: { title: 'Hello' } });
        expect(a.created).toBe(true);
        const b = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-1', bindingName: 'site', profile: {} });
        expect(b).toEqual({ artifactId: a.artifactId, created: false });
        const raced = await Promise.all(Array.from({ length: 8 }, () =>
          h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-race', bindingName: 'race', profile: {} })));
        expect(new Set(raced.map((r) => r.artifactId)).size).toBe(1);
        expect(raced.filter((r) => r.created).length).toBe(1);
        await h.store.markTerminal(a.artifactId);
        await expect(h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-1', bindingName: 'site', profile: {} }))
          .rejects.toThrow(/gone/);
      } finally { await h.close(); }
    });

    it('records, completes, fails and lists intents in creation order', async () => {
      const h = await backend.open();
      try {
        const first = await h.store.record('commit-release', { artifactId: 'a-1' });
        const second = await h.store.record('delete-blob', { digest: 'sha256:aa' });
        expect(first.state).toBe('pending');
        await h.store.complete(first.intentId);
        expect((await h.store.listPending()).map((i) => i.intentId)).toEqual([second.intentId]);
        await h.store.markFailed(second.intentId, 'boom');
        expect(await h.store.listPending()).toEqual([]);
        expect((await h.store.get(second.intentId))?.error).toBe('boom');
        await expect(h.store.complete('missing')).rejects.toThrow(/unknown intent/);
      } finally { await h.close(); }
    });

    it('filters due preparation-cleanup reads, claims and settles them', async () => {
      const h = await backend.open();
      try {
        const payload = { cleanupDeadlineMs: 100, preparedAtMs: 10, artifactId: 'batch' };
        const done = await h.store.record('commit-release', payload);
        await h.store.complete(done.intentId);
        const pending = await h.store.record('commit-release', payload);
        const failed = await h.store.record('commit-release', payload);
        await h.store.markFailed(failed.intentId, 'boom');
        await h.store.settlePreparationCleanup(failed.intentId);
        // Non-done commit-release intents with a deadline: pending first, failed-cleaned last.
        expect((await h.store.listPreparationIntents({ throughMs: 100, limit: 1 })).map((i) => i.intentId)).toEqual([pending.intentId]);
        expect(await h.store.listPreparationIntents({ throughMs: 99 })).toEqual([]);
        expect((await h.store.listPreparationIntents({ artifactId: 'batch' })).length).toBe(2);
        expect((await h.store.listPreparationIntents({ artifactId: 'other' })).length).toBe(0);
        expect(await h.store.claimPreparationCleanup(done.intentId, 200)).toBeUndefined();
        expect(await h.store.claimPreparationCleanup(pending.intentId, 50)).toBeUndefined();
        const claimed = await h.store.claimPreparationCleanup(pending.intentId, 200);
        expect(claimed?.state).toBe('failed');
        expect(claimed?.error).toBe('preparation expired; explicit retry required');
        await expect(h.store.settlePreparationCleanup(done.intentId)).rejects.toThrow(/cleanup needs a failed preparation/);
        await h.store.settlePreparationCleanup(pending.intentId);
        expect((await h.store.get(pending.intentId))?.payload['cleanupState']).toBe('failed-cleaned');
      } finally { await h.close(); }
    });

    it('executes idempotent operations once per winner and conflicts on a different hash', async () => {
      const h = await backend.open();
      try {
        let calls = 0;
        const work = async () => { calls += 1; return { releaseId: 'r-1' }; };
        const first = await h.store.execute('k-1', 'h-1', work);
        const second = await h.store.execute('k-1', 'h-1', work);
        expect(calls).toBe(1);
        expect(first).toEqual({ result: { releaseId: 'r-1' }, replayed: false });
        expect(second).toEqual({ result: { releaseId: 'r-1' }, replayed: true });
        const concurrent = await Promise.all(Array.from({ length: 6 }, () => h.store.execute('k-race', 'h-race', work)));
        // Exactly one caller wins the insert; every other caller replays the winner's result.
        expect(concurrent.filter((r) => !r.replayed).length).toBe(1);
        for (const r of concurrent) expect(r.result).toEqual({ releaseId: 'r-1' });
        expect(calls).toBeGreaterThanOrEqual(2);
        expect(calls).toBeLessThanOrEqual(8);
        await expect(h.store.execute('k-1', 'h-2', work)).rejects.toThrow(/idempotency conflict/);
      } finally { await h.close(); }
    });

    it('stores and replaces ACLs with grants, public flag, withdrawal and metadata', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-acl', bindingName: 'acl', profile: {} });
        expect(await h.store.getArtifactAcl('00000000-0000-4000-8000-000000000000')).toBeUndefined();
        await h.store.putArtifactAcl(ensured.artifactId, {
          ownerId: 'owner-acl', isPublic: true, withdrawn: false,
          grants: [{ principalId: 'reader-1', grant: 'read' }],
        });
        await h.store.putArtifactAcl(ensured.artifactId, {
          ownerId: 'owner-acl', isPublic: false, withdrawn: true,
          grants: [{ principalId: 'reader-2', grant: 'source' }], metadata: { title: 'Page', icon: 'doc' },
        });
        const acl = await h.store.getArtifactAcl(ensured.artifactId);
        expect(acl).toMatchObject({
          ownerId: 'owner-acl', storageScopeId: SCOPE, isPublic: false, withdrawn: true,
          grants: [{ principalId: 'reader-2', grant: 'source' }], metadata: { title: 'Page', icon: 'doc' },
          bindingName: 'acl',
        });
        expect(await h.store.listArtifactIds()).toContain(ensured.artifactId);
      } finally { await h.close(); }
    });

    it('stores and replaces sources', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-src', bindingName: 'src', profile: {} });
        expect(await h.store.getSource(ensured.artifactId)).toBeUndefined();
        await h.store.putSource(ensured.artifactId, { kind: 'base-commit', commit: 'abc' });
        await h.store.putSource(ensured.artifactId, { kind: 'recipe', steps: ['a', 'b'] });
        expect(await h.store.getSource(ensured.artifactId)).toEqual({ kind: 'recipe', steps: ['a', 'b'] });
        await h.store.putSource(ensured.artifactId, { kind: 'inline-original' });
        expect(await h.store.getSource(ensured.artifactId)).toEqual({ kind: 'inline-original' });
      } finally { await h.close(); }
    });

    it('tracks lifecycle states, renewal and release states on real rows', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-life', bindingName: 'life', profile: {} });
        await expect(h.store.register('00000000-0000-4000-8000-000000000000', 'owner-life')).rejects.toThrow(/unknown artifact/);
        await h.store.register(ensured.artifactId, 'owner-life');
        await expect(h.store.register(ensured.artifactId, 'other')).rejects.toThrow(/owner mismatch/);
        expect(await h.store.getOwner(ensured.artifactId)).toBe('owner-life');
        expect(await h.store.getArtifactState(ensured.artifactId)).toBe('active');
        await h.store.setArtifactState(ensured.artifactId, 'withdrawn');
        expect(await h.store.getArtifactState(ensured.artifactId)).toBe('withdrawn');
        await h.store.setRenewedAt(ensured.artifactId, '2026-01-01T00:00:00.000Z');
        expect(await h.store.getRenewedAt(ensured.artifactId)).toBe('2026-01-01T00:00:00.000Z');
        await h.store.putRelease(release(ensured.artifactId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
        await h.store.addRelease(ensured.artifactId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
        expect(await h.store.listArtifactReleases(ensured.artifactId)).toEqual(['dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
        expect(await h.store.getReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe('ready');
        await h.store.setReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'retired');
        expect(await h.store.getReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe('retired');
        expect(await h.store.isTerminal(ensured.artifactId)).toBe(false);
        await h.store.markTerminal(ensured.artifactId);
        expect(await h.store.isTerminal(ensured.artifactId)).toBe(true);
        await expect(h.store.setArtifactState(ensured.artifactId, 'active')).rejects.toThrow(/terminal/);
      } finally { await h.close(); }
    });

    it('promotes the current release with a real CAS and registers manifest blobs', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-cas', bindingName: 'cas', profile: {} });
        const id = ensured.artifactId;
        const files = [
          { path: 'a.html', digest: 'sha256:aa', size: 1, mimeType: 'text/html' },
          { path: 'b.html', digest: 'sha256:bb', size: 2, mimeType: 'text/html' },
        ];
        await h.store.putRelease(release(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cc'.repeat(32), JSON.stringify({ schemaVersion: 'artifacts/v1', files })));
        await h.store.putRelease(release(id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
        await h.store.putRelease(release(id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
        expect(await h.store.getCurrentReleaseId(id)).toBeUndefined();
        expect(await h.store.compareAndSwapCurrent(id, null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true);
        expect(await h.store.compareAndSwapCurrent(id, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false);
        expect(await h.store.compareAndSwapCurrent(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
        const raced = await Promise.all([
          h.store.compareAndSwapCurrent(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
          h.store.compareAndSwapCurrent(id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        ]);
        expect([...raced].sort()).toEqual([false, true]);
        expect(await h.store.getCurrentReleaseId(id)).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        const history = await h.store.listReleases(id);
        expect(history.map((r) => r.releaseId)).toEqual([
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ]);
        expect((await h.store.getRelease('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))?.manifestDigest).toBe('cc'.repeat(32));
        expect(await h.store.listRegisteredBlobs(SCOPE)).toEqual(['sha256:aa', 'sha256:bb']);
      } finally { await h.close(); }
    });

    it('counts holders and pins exactly with strict errors', async () => {
      const h = await backend.open();
      try {
        expect(await h.store.count('sha256:aa')).toBe(0);
        expect(await h.store.isPinned('sha256:aa')).toBe(false);
        await h.store.addRef('sha256:aa', 'release-r1');
        await h.store.addRef('sha256:aa', 'release-r1');
        await h.store.addRef('sha256:aa', 'release-r2');
        expect(await h.store.count('sha256:aa')).toBe(2);
        await h.store.pin('sha256:aa', 'legal-hold');
        expect(await h.store.isPinned('sha256:aa')).toBe(true);
        await expect(h.store.pin('sha256:aa', 'legal-hold')).rejects.toThrow(/duplicate pin/);
        await h.store.releaseRef('sha256:aa', 'release-r1');
        expect(await h.store.count('sha256:aa')).toBe(1);
        await expect(h.store.releaseRef('sha256:aa', 'release-r1')).rejects.toThrow(/not held/);
        await h.store.unpin('sha256:aa', 'legal-hold');
        expect(await h.store.isPinned('sha256:aa')).toBe(false);
        await expect(h.store.unpin('sha256:aa', 'legal-hold')).rejects.toThrow(/not pinned/);
      } finally { await h.close(); }
    });

    it('survives a restart (reopen) with all durable state intact', async () => {
      const h = await backend.open();
      const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-restart', bindingName: 'restart', profile: { title: 'T' } });
      await h.store.putRelease(release(ensured.artifactId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
      await h.store.compareAndSwapCurrent(ensured.artifactId, null, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      await h.store.putArtifactAcl(ensured.artifactId, { ownerId: 'owner-restart', isPublic: true, withdrawn: false, grants: [{ principalId: 'r', grant: 'read' }] });
      await h.store.addRef('sha256:cc', 'holder-1');
      await h.store.pin('sha256:cc', 'hold');
      const intent = await h.store.record('promote-release', { artifactId: ensured.artifactId });
      await h.executor.ensureCoordinationRow(SCOPE, 'restart-key');
      await h.close();
      const reopened = await h.reopen();
      try {
        const again = await reopened.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-restart', bindingName: 'restart', profile: {} });
        expect(again).toEqual({ artifactId: ensured.artifactId, created: false });
        expect(await reopened.store.getCurrentReleaseId(ensured.artifactId)).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        expect((await reopened.store.getArtifactAcl(ensured.artifactId))?.isPublic).toBe(true);
        expect(await reopened.store.count('sha256:cc')).toBe(1);
        expect(await reopened.store.isPinned('sha256:cc')).toBe(true);
        expect((await reopened.store.get(intent.intentId))?.state).toBe('pending');
      } finally { await reopened.close(); }
    });

    it('serializes concurrent mixed writers without losing updates', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-w', bindingName: 'w', profile: {} });
        const id = ensured.artifactId;
        await Promise.all(Array.from({ length: 12 }, (_, i) =>
          h.store.addRef(`sha256:w${i % 3}`, `holder-${i}`)));
        await Promise.all(Array.from({ length: 6 }, (_, i) =>
          h.store.putRelease(release(id, `ffff${String(i).padStart(4, '0')}-ffff-4fff-8fff-ffffffffffff`))));
        expect(await h.store.count('sha256:w0')).toBe(4);
        expect(await h.store.count('sha256:w1')).toBe(4);
        expect(await h.store.count('sha256:w2')).toBe(4);
        expect((await h.store.listReleases(id)).length).toBe(6);
        let expected: string | null = null;
        for (let i = 0; i < 6; i++) {
          const next = `ffff${String(i).padStart(4, '0')}-ffff-4fff-8fff-ffffffffffff`;
          expect(await h.store.compareAndSwapCurrent(id, expected, next)).toBe(true);
          expected = next;
        }
        expect(await h.store.getCurrentReleaseId(id)).toBe('ffff0005-ffff-4fff-8fff-ffffffffffff');
      } finally { await h.close(); }
    });
  });
}

/** Coordinator-level conformance: executor seam plus the real coordinator. */
export function runCoordinatorConformance(backend: ConformanceBackend): void {
  describe(`${backend.name} commit coordinator conformance`, () => {
    const participantFactory = (clock: () => number): CommitPolicyParticipantFactory => ({
      createParticipant: (client: FinalizeTxClient, transactionToken: string): ArtifactPolicyDriver => ({
        async readRevision(): Promise<string> {
          const { rows } = await client.query<{ revision: string }>('SELECT revision FROM commit_test.policy_revision WHERE id = 1', []);
          return rows[0]!.revision;
        },
        async checkApproval(input): Promise<{ approved: boolean; reason?: 'denied' | 'expired' }> {
          const { rows } = await client.query<{ approved: number; expires_at_ms: number }>(
            'SELECT approved, expires_at_ms FROM commit_test.approvals WHERE actor_id = $1', [input.actorId]);
          const row = rows[0];
          if (row === undefined || !row.approved) return { approved: false, reason: 'denied' };
          if (Number(row.expires_at_ms) <= clock()) return { approved: false, reason: 'expired' };
          return { approved: true };
        },
        async reserveQuota(): Promise<{ reserved: boolean }> {
          const { rowCount } = await client.query('UPDATE commit_test.quotas SET used = used + 1 WHERE quota_key = $1 AND used < total', ['q-main']);
          return { reserved: rowCount > 0 };
        },
        mintFence: (revision, invocationId) => ({
          fenceId: `fence-${transactionToken}`, transactionId: transactionToken,
          invocationId, policyRevision: revision,
        }),
      }),
    });

    const guard = async (context: ArtifactCommitContext, transaction: ArtifactCommitTransaction): Promise<ArtifactAuthorizationDecision> => {
      const revision = await transaction.participant.readRevision();
      if (context.policyRevision !== revision) {
        return { allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false };
      }
      const check = await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation });
      if (!check.approved) return { allowed: false, reason: check.reason ?? 'denied', publicCode: 'access_denied', status: 403, retriable: false };
      return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
    };

    const baseRequest = (overrides?: Partial<FinalizeRequest> & { key?: string }): FinalizeRequest => ({
      scopeId: SCOPE,
      internalKey: (overrides?.key ?? freshKey()) as InternalIdempotencyKey,
      commandHash: '9a159e31bdd2a0415be1bf65c70e37c29d5076365616af5acc356ee8210c8ff1',
      codecVersion: 'artifacts-command/v1',
      invocationId: `inv-${Math.random().toString(36).slice(2)}`,
      actorId: 'actor-1',
      operation: 'publish',
      artifactId: null,
      bindingName: null,
      policyRevision: 'rev-1',
      guard,
      receiptData: { releaseId: 'r-1' },
      ...overrides,
    });

    it('converges concurrent coordination rows on one key row', async () => {
      const h = await backend.open();
      try {
        await h.setupCommitTest();
        await Promise.all(Array.from({ length: 8 }, () => h.executor.ensureCoordinationRow(SCOPE, 'race-key')));
        expect(await h.countOperationKeys(SCOPE, 'race-key')).toBe(1);
      } finally { await h.close(); }
    });

    it('commits one success receipt, replays it, conflicts on a new hash and rolls back denials', async () => {
      const h = await backend.open();
      try {
        await h.setupCommitTest();
        const coordinator = createArtifactCommitCoordinator({ executor: h.executor, policy: participantFactory(() => Date.now()) });
        let provisionalCalls = 0;
        const provisional = async (client: FinalizeTxClient): Promise<void> => {
          provisionalCalls += 1;
          await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [SCOPE, 'key-replay']);
        };
        const first = await coordinator.finalizePrepared(baseRequest({ key: 'key-replay', commandHash: 'h-replay', provisional }));
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.replayed).toBe(false);
        expect(first.commitState).toBe('committed');
        const second = await coordinator.finalizePrepared(baseRequest({ key: 'key-replay', commandHash: 'h-replay', provisional }));
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.replayed).toBe(true);
        expect(provisionalCalls).toBe(1);
        const conflict = await coordinator.finalizePrepared(baseRequest({ key: 'key-replay', commandHash: 'h-other' }));
        expect(conflict.ok).toBe(false);
        if (conflict.ok) return;
        expect(conflict.failure.category).toBe('conflict');
        expect(conflict.failure.httpStatus).toBe(409);
        expect(conflict.failure.commitState).toBe('not_committed');
        const denied = await coordinator.finalizePrepared(baseRequest({
          key: 'key-denied', commandHash: 'h-denied',
          guard: async () => ({ allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false }),
          provisional: async (client) => {
            await client.query('INSERT INTO commit_test.effects (scope_id, internal_key) VALUES ($1, $2)', [SCOPE, 'key-denied']);
          },
        }));
        expect(denied.ok).toBe(false);
        if (denied.ok) return;
        expect(denied.failure.category).toBe('unauthorized_at_commit');
        expect(denied.failure.commitState).toBe('not_committed');
        expect(await h.countCommitTest('effects', ' WHERE internal_key = $1', ['key-denied'])).toBe(0);
        expect(await h.countCommitTest('effects', ' WHERE internal_key = $1', ['key-replay'])).toBe(1);
        const conn = await h.executor.beginFinalization();
        const receipt = await conn.readReceipt(SCOPE, 'key-replay' as InternalIdempotencyKey);
        expect(receipt?.commandHash).toBe('h-replay');
        expect((receipt?.receipt as { releaseId: string }).releaseId).toBe('r-1');
        await conn.rollback();
        conn.release();
      } finally { await h.close(); }
    });

    it('serializes concurrent finalizations on the same key (one receipt wins)', async () => {
      const h = await backend.open();
      try {
        await h.setupCommitTest();
        const coordinator = createArtifactCommitCoordinator({ executor: h.executor, policy: participantFactory(() => Date.now()) });
        const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
          coordinator.finalizePrepared(baseRequest({ key: 'key-serial', commandHash: 'h-serial', invocationId: `inv-${i}` }))));
        const committed = results.filter((r) => r.ok && !r.replayed);
        expect(committed.length).toBe(1);
        expect(await h.countReceipts(SCOPE, 'key-serial')).toBe(1);
      } finally { await h.close(); }
    });
  });
}

/** Management-unit conformance over a live finalization connection. */
export function runManagementConformance(backend: ConformanceBackend): void {
  describe(`${backend.name} management unit conformance`, () => {
    it('locks, reads, grants, revokes and deletes inside one finalization', async () => {
      const h = await backend.open();
      try {
        const ensured = await h.store.ensureArtifact({ storageScopeId: SCOPE, ownerId: 'owner-mgmt', bindingName: 'mgmt', profile: {} });
        const id = ensured.artifactId;
        await h.store.putArtifactAcl(id, { ownerId: 'owner-mgmt', isPublic: true, withdrawn: false, grants: [] });
        await h.store.putRelease(release(id, '99999999-9999-4999-8999-999999999999'));
        await h.store.compareAndSwapCurrent(id, null, '99999999-9999-4999-8999-999999999999');
        const conn = await h.executor.beginFinalization();
        try {
          const unit = h.makeUnit(conn);
          await unit.lock(id);
          const target = await unit.read(id);
          expect(target).toMatchObject({ state: 'active', terminal: false, currentReleaseId: '99999999-9999-4999-8999-999999999999' });
          expect(target?.acl.ownerId).toBe('owner-mgmt');
          const granted = await unit.setAccess(id, 'reader-9', 'grant', '2026-02-02T00:00:00.000Z');
          expect(granted.grants).toEqual([{ principalId: 'reader-9', grant: 'read' }]);
          expect((await unit.read(id))?.acl.isPublic).toBe(false);
          const revoked = await unit.setAccess(id, 'reader-9', 'revoke', '2026-02-03T00:00:00.000Z');
          expect(revoked.grants).toEqual([]);
          await unit.delete(id, '2026-02-04T00:00:00.000Z');
          const gone = await unit.read(id);
          expect(gone).toMatchObject({ state: 'deleted', terminal: true });
          await conn.commit();
        } finally { conn.release(); }
        expect(await h.store.isTerminal(id)).toBe(true);
        expect(await h.store.getArtifactState(id)).toBe('deleted');
        expect((await h.store.getArtifactAcl(id))?.isPublic).toBe(false);
      } finally { await h.close(); }
    });
  });
}

export function runBlobConformance(backend: ConformanceBackend): void {
  describe(`${backend.name} blob store conformance`, () => {
    // Keys are derived from the real content digests so the same suite runs
    // against digest-verifying backends (local store) and plain ones (S3).
    const bytes = (n: number[]): Uint8Array => new Uint8Array(n);
    const keyOf = (scope: string, content: Uint8Array): string =>
      `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(content).digest('hex')}`;
    const CONTENT_A = bytes([0, 255, 1, 2, 3]);
    const CONTENT_B = bytes([2]);
    const CONTENT_OTHER = bytes([3]);
    const KEY_A = keyOf('scope-1', CONTENT_A);
    const KEY_B = keyOf('scope-1', CONTENT_B);
    const KEY_OTHER = keyOf('scope-9', CONTENT_OTHER);

    it('round-trips bytes, reads absent as undefined, lists prefixes sorted and deletes', async () => {
      const h = await backend.open();
      const blob = await h.makeBlobStore();
      try {
        await blob.blobs.putBlob(KEY_A, CONTENT_A);
        expect(await blob.blobs.getBlob(KEY_A)).toEqual(CONTENT_A);
        expect(await blob.blobs.getBlob(KEY_B)).toBeUndefined();
        await blob.blobs.putBlob(KEY_B, CONTENT_B);
        await blob.blobs.putBlob(KEY_OTHER, CONTENT_OTHER);
        expect(await blob.blobs.listKeys('artifacts/scope-1/blobs/')).toEqual([KEY_A, KEY_B]);
        expect(await blob.blobs.listKeys('artifacts/')).toEqual([KEY_A, KEY_B, KEY_OTHER]);
        expect(await blob.blobs.listKeys('artifacts/missing/')).toEqual([]);
        await blob.blobs.deleteBlob(KEY_B);
        expect(await blob.blobs.getBlob(KEY_B)).toBeUndefined();
      } finally { await blob.cleanup(); await h.close(); }
    });

    it('refuses hostile keys and prefixes before any I/O', async () => {
      const h = await backend.open();
      const blob = await h.makeBlobStore();
      try {
        for (const key of ['../evil', '/absolute', 'other/prefix/x', 'artifacts/scope-1/blobs/sha256/ZZZ', 'artifacts/../scope-1/blobs/sha256/aa', '']) {
          await expect(blob.blobs.putBlob(key, bytes([1]))).rejects.toThrow(/key/);
          await expect(blob.blobs.getBlob(key)).rejects.toThrow(/key/);
          await expect(blob.blobs.deleteBlob(key)).rejects.toThrow(/key/);
        }
        for (const prefix of ['', '..', '../x', 'artifacts/../scope-1/']) {
          await expect(blob.blobs.listKeys(prefix)).rejects.toThrow(/prefix/);
        }
      } finally { await blob.cleanup(); await h.close(); }
    });

    it('verifies digests when the backend supports it and survives restart', async () => {
      const h = await backend.open();
      const blob = await h.makeBlobStore();
      try {
        await blob.blobs.putBlob(KEY_A, CONTENT_A);
        if (blob.verifiesDigest) {
          // A digest-mismatched write must be refused before persisting.
          await expect(blob.blobs.putBlob(KEY_B, bytes([9, 9, 9]))).rejects.toThrow(/digest/);
          expect(await blob.blobs.getBlob(KEY_B)).toBeUndefined();
        }
        await h.close();
        const reopened = await h.reopen();
        const blob2 = await reopened.makeBlobStore();
        try {
          expect(await blob2.blobs.getBlob(KEY_A)).toEqual(CONTENT_A);
          expect(await blob2.blobs.listKeys('artifacts/scope-1/blobs/')).toEqual([KEY_A]);
        } finally { await blob2.cleanup(); await reopened.close(); }
      } finally { await blob.cleanup(); }
    });
  });
}
