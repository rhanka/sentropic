/**
 * L3 (immo #861) — atomic finalization coordinator (spec r2 §3.1 A4).
 *
 * One atomic database finalization unit per (scope, internal key):
 * coordination row, key recheck, ordered locks (object, authority, quota,
 * blob-claim), provisional writes, the host guard after all waits, fenced
 * final predicate, one success insert and one COMMIT. The quota wait always
 * precedes the guard decision and its locks are retained through COMMIT; a
 * second guard invocation revalidates authority after the post-guard
 * receipt/intent/barrier waits, so an approval expiring mid-unit denies
 * instead of committing. Denial or genuine conflict rolls the unit back
 * with no committed residue. A connection loss around COMMIT acknowledgment
 * is a separate unknown outcome recovered by retrying the same key. The
 * success table is distinct from idempotency_keys, which the coordinator
 * never touches.
 */
import { randomUUID } from 'node:crypto';
import {
  COMMAND_CODEC_VERSION,
  COORDINATOR_TEST_POINTS,
  PARTICIPANT_LOCK_ORDER,
  CommitQuarantineError,
  FAILURE_PROJECTIONS,
  type ArtifactAuthorizationDecision,
  type ArtifactAuthorizationFence,
  type ArtifactCommitContext,
  type CommitPolicyParticipant,
  type FinalizationCoordinator,
  type ArtifactCommitTransaction,
  type ArtifactFailure,
  type CommitCoordinatorOptions,
  type CoordinatorTestPoint,
  type FailureCategory,
  type FinalizeConnection,
  type FinalizeRequest,
  type FinalizeResult,
  type ParticipantLockClass,
  type StoredCommitReceipt,
} from './types.js';

function failure(
  category: FailureCategory,
  request: FinalizeRequest,
  phase: string,
  commitState: 'not_committed' | 'committed' | 'unknown',
  cause: unknown,
  overrides?: { publicCode?: string; status?: number; retriable?: boolean; variant?: string },
): ArtifactFailure {
  const row =
    FAILURE_PROJECTIONS.find((entry) => entry.category === category && entry.variant === overrides?.variant) ??
    FAILURE_PROJECTIONS.find((entry) => entry.category === category);
  if (row === undefined) throw new Error(`unknown failure category ${category}`);
  return {
    kind: 'operational' as const,
    category,
    variant: overrides?.variant ?? row.variant,
    httpStatus: overrides?.status ?? row.httpStatus,
    publicCode: overrides?.publicCode ?? row.publicCode,
    retriable: overrides?.retriable ?? row.retriable,
    invocationId: request.invocationId,
    operation: request.operation,
    phase,
    commitState,
    cause,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Shared acknowledgment-loss contract (r2 E3): PG connection loss plus the
 * adapter-level unacknowledged-COMMIT code. Any of these around COMMIT
 * means the outcome is unknown, never not_committed.
 */
const CONNECTION_LOSS_CODES = new Set([
  '57P06',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'artifact_connection_lost',
]);

const isConnectionLoss = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return (
    (typeof code === 'string' && (CONNECTION_LOSS_CODES.has(code) || code.startsWith('08'))) ||
    /terminating connection|connection reset|connection refused/i.test(String(error))
  );
};

const LOCK_TIMEOUT_CODE = '55P03';

/** Serialization/deadlock/cancel outcomes: retriable unavailability (r2 E3/P2-2). */
const RETRIABLE_SQLSTATES = new Set(['40001', '40P01', '57014']);

/**
 * Granular unit phases. Failures carry the phase in which they were
 * produced; the coordinator never generalizes to a single unit phase, so a
 * projector can distinguish qualified key contention from infrastructure
 * timeouts without guessing from messages.
 */
type UnitPhase = 'acquire' | 'lock' | 'guard' | 'commit' | 'resolve';

const classifyOperational = (
  request: FinalizeRequest,
  phase: UnitPhase,
  commitState: 'not_committed' | 'unknown',
  error: unknown,
): ArtifactFailure => {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (
    isConnectionLoss(error) ||
    code === LOCK_TIMEOUT_CODE ||
    (typeof code === 'string' && RETRIABLE_SQLSTATES.has(code))
  ) {
    // E3: any lock timeout outside the scoped key-row acquisition is
    // retriable infrastructure contention, never a key conflict.
    return failure('provider_unavailable', request, phase, commitState, error);
  }
  return failure('provider_error', request, phase, commitState, error, { variant: 'unclassified' });
};

/** Explicit per-connection settlement handle. */
interface UnitSettlement {
  /** Roll back and release exactly once; returns the settlement error, if any. */
  abort(): Promise<unknown>;
  /** Release a clean connection exactly once (post-commit or read-only resolve). */
  releaseClean(): void;
}

/**
 * Every leased transaction is settled exactly once, including exceptional
 * paths: rollback failure destroys the client instead of returning an
 * uncertain session to the pool, and repeated calls are no-ops.
 */
const trackSettlement = (connection: FinalizeConnection): UnitSettlement => {
  let settled = false;
  return {
    async abort(): Promise<unknown> {
      if (settled) return undefined;
      settled = true;
      try {
        await connection.rollback();
      } catch (rollbackError) {
        try {
          connection.release(rollbackError);
        } catch {
          /* release already attempted */
        }
        return rollbackError;
      }
      try {
        connection.release();
      } catch {
        /* release already attempted */
      }
      return undefined;
    },
    releaseClean(): void {
      if (settled) return;
      settled = true;
      try {
        connection.release();
      } catch {
        /* release already attempted */
      }
    },
  };
};

/**
 * Pre-quota lock classes, in A4.4 order. Guarded replay runs exactly these:
 * object/ACL/policy serialization without quota charge or blob claims.
 */
const PRE_QUOTA_LOCK_CLASSES: readonly ParticipantLockClass[] = PARTICIPANT_LOCK_ORDER.filter(
  (entry) => entry !== 'quota' && entry !== 'blob-reference-deletion-claim',
);

export function createArtifactCommitCoordinator(options: CommitCoordinatorOptions): FinalizationCoordinator {
  const nowMs = options.nowMs ?? (() => Date.now());
  for (const point of options.testPoints ?? []) {
    if (!COORDINATOR_TEST_POINTS.includes(point)) {
      throw new Error(`unknown coordinator test point ${point}`);
    }
  }
  const armed = new Set(options.testPoints ?? []);
  const fired = new Set<string>();
  const observeAt = async (
    point: CoordinatorTestPoint,
    invocationId: string,
  ): Promise<void> => {
    const key = `${point}:${invocationId}`;
    if (options.testObserver === undefined || !armed.has(point) || fired.has(key)) return;
    fired.add(key);
    await options.testObserver(point, invocationId);
  };

  const commitContext = (
    request: FinalizeRequest,
    purpose: 'finalize' | 'replay',
  ): ArtifactCommitContext => ({
    invocationId: request.invocationId,
    actorId: request.actorId,
    storageScopeId: request.scopeId,
    authorizeCommit: request.guard,
    operation: request.operation,
    artifactId: request.artifactId ?? '',
    bindingId: request.bindingName ?? '',
    commandIdentity: {
      internalKey: request.internalKey,
      commandHash: request.commandHash,
      codecVersion: request.codecVersion as typeof COMMAND_CODEC_VERSION,
    },
    policyRevision: request.policyRevision,
    purpose,
  });

  /**
   * Best-effort preparation-abandonment hook. Its failure is isolated: it
   * never replaces the primary authorization decision with a cleanup error,
   * and it never settles the connection a second time.
   */
  const abandon = async (request: FinalizeRequest): Promise<void> => {
    if (request.noteAbandonedAttempt === undefined) return;
    try {
      await request.noteAbandonedAttempt(request.attemptId ?? request.internalKey);
    } catch {
      /* abandonment hooks are best-effort; the primary decision stands */
    }
  };

  const unknownOutcome = (
    request: FinalizeRequest,
    phase: UnitPhase,
    cause: unknown,
  ): FinalizeResult => ({
    ok: false,
    failure: failure('provider_unavailable', request, phase, 'unknown', cause),
  });

  /**
   * Settle the unit, record abandonment, and produce either the primary
   * failure or an unknown outcome when settlement itself failed (the primary
   * cause is preserved inside the unknown outcome).
   */
  const abortWith = async (
    request: FinalizeRequest,
    phase: UnitPhase,
    settle: UnitSettlement,
    primary: FinalizeResult,
  ): Promise<FinalizeResult> => {
    const settleError = await settle.abort();
    await abandon(request);
    if (settleError === undefined) return primary;
    return unknownOutcome(request, phase, { decision: primary, settlement: settleError });
  };

  /**
   * Acquire the scoped key row. Only a lock timeout on this exact
   * acquisition qualifies as key contention; every other lock/read timeout
   * stays retriable unavailability via the shared classifier.
   */
  const acquireKeyLock = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
    settle: UnitSettlement,
  ): Promise<FinalizeResult | undefined> => {
    try {
      await connection.lockOperationKey(request.scopeId, request.internalKey);
      return undefined;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === LOCK_TIMEOUT_CODE) {
        return abortWith(
          request,
          'lock',
          settle,
          {
            ok: false,
            failure: failure('conflict', request, 'lock', 'not_committed', error, {
              variant: 'key_contention',
            }),
          },
        );
      }
      throw error;
    }
  };

  /**
   * Settle the unit before propagating quarantine, regardless of source.
   * A hook raising quarantine before settlement must not leak the lease;
   * settling twice is a no-op.
   */
  const settleAndPropagateQuarantine = async (
    request: FinalizeRequest,
    settle: UnitSettlement,
    error: CommitQuarantineError,
  ): Promise<never> => {
    await settle.abort();
    await abandon(request);
    throw error;
  };

  /**
   * The COMMIT was attempted: a successful ROLLBACK afterwards cannot prove
   * the COMMIT failed, so the outcome is unknown however the commit error
   * classifies.
   */
  const unknownAfterCommitAttempt = async (
    request: FinalizeRequest,
    settle: UnitSettlement,
    error: unknown,
  ): Promise<FinalizeResult> => {
    const settleError = await settle.abort();
    await abandon(request);
    return unknownOutcome(
      request,
      'commit',
      settleError === undefined ? error : { commit: error, settlement: settleError },
    );
  };

  const deny = (
    request: FinalizeRequest,
    decision: Extract<ArtifactAuthorizationDecision, { allowed: false }>,
  ): FinalizeResult => ({
    ok: false,
    failure: failure(
      'unauthorized_at_commit',
      request,
      'guard',
      'not_committed',
      { denialReason: decision.reason },
      {
        publicCode: decision.publicCode,
        status: decision.status,
        retriable: decision.retriable,
        variant: decision.status === 503 ? 'authority_unavailable' : 'policy_denial',
      },
    ),
  });

  const revokedOutcome = (request: FinalizeRequest): FinalizeResult => ({
    ok: false,
    failure: failure(
      'unauthorized_at_commit',
      request,
      'guard',
      'not_committed',
      { denialReason: 'revoked' as const },
      { publicCode: 'access_denied', status: 403, retriable: false, variant: 'policy_denial' },
    ),
  });

  const invalidFence = (request: FinalizeRequest, detail: string): FinalizeResult => ({
    ok: false,
    failure: failure('unauthorized_at_commit', request, 'guard', 'not_committed', {
      denialReason: 'invalid_object',
      fence: detail,
    }, { variant: 'policy_denial' }),
  });

  /**
   * A fence is valid only when minted by this transaction: its transactionId
   * must equal the token the coordinator issued to the participant factory,
   * its fenceId must be non-empty, its invocation must match the request,
   * and its revision must match the freshly re-read policy revision.
   * Fabricated, foreign or stale fences deny before any success work.
   * The credential must be one of the transaction-local mint outputs:
   * matching fields alone never prove minting.
   */
  const bindTransaction = (
    request: FinalizeRequest,
    connection: FinalizeConnection,
    transactionToken: string,
  ): { transaction: ArtifactCommitTransaction; minted: Set<ArtifactAuthorizationFence> } => {
    const minted = new Set<ArtifactAuthorizationFence>();
    const raw = options.policy.createParticipant(connection, transactionToken);
    const participant: CommitPolicyParticipant = {
      readRevision: () => raw.readRevision(),
      checkApproval: (input) => raw.checkApproval(input),
      reserveQuota: (input) => raw.reserveQuota(input),
      mintFence: (revision, invocationId) => {
        const fence = raw.mintFence(revision, invocationId);
        minted.add(fence);
        return fence;
      },
    };
    return {
      transaction: {
        transactionId: transactionToken,
        invocationId: request.invocationId,
        policyRevision: request.policyRevision,
        participant,
      },
      minted,
    };
  };

  const verifyFence = (
    request: FinalizeRequest,
    transaction: ArtifactCommitTransaction,
    minted: Set<ArtifactAuthorizationFence>,
    fence: ArtifactAuthorizationFence,
    currentRevision: string,
  ): { ok: true } | { ok: false; detail: string } => {
    if (!minted.has(fence)) {
      return { ok: false, detail: 'unminted_fence' };
    }
    if (fence.transactionId !== transaction.transactionId) {
      return { ok: false, detail: 'foreign_fence' };
    }
    if (fence.fenceId.length === 0) return { ok: false, detail: 'empty_fence_id' };
    if (fence.invocationId !== request.invocationId) {
      return { ok: false, detail: 'mismatched_invocation' };
    }
    if (fence.policyRevision !== currentRevision) return { ok: false, detail: 'stale_revision' };
    return { ok: true };
  };

  const runLockGroup = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
    classes: readonly ParticipantLockClass[],
  ): Promise<void> => {
    for (const lockClass of classes) {
      const callbacks = request.locks?.[lockClass];
      if (callbacks === undefined) continue;
      for (const acquire of callbacks) await acquire(connection);
    }
  };

  const validateRequest = (request: FinalizeRequest, operation: 'finalize' | 'replay'): void => {
    if (request.scopeId.length === 0 || request.internalKey.length === 0) {
      throw new Error(`${operation} requires scope and internal key`);
    }
    if (request.commandHash.length === 0 || request.codecVersion.length === 0) {
      throw new Error(`${operation} requires command hash and codec version`);
    }
    if (request.codecVersion !== COMMAND_CODEC_VERSION) {
      throw new Error(`${operation} requires supported command codec ${COMMAND_CODEC_VERSION}`);
    }
  };

  /**
   * COMMIT with acknowledgment-loss isolation. Returns undefined when
   * committed and the unknown failure when the acknowledgment was lost;
   * any other commit error is rethrown for phase-aware classification.
   */
  const commitUnit = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
    settle: UnitSettlement,
  ): Promise<FinalizeResult | undefined> => {
    try {
      await connection.commit();
    } catch (error) {
      if (!isConnectionLoss(error)) throw error;
      const settleError = await settle.abort();
      return unknownOutcome(
        request,
        'commit',
        settleError === undefined ? error : { commit: error, settlement: settleError },
      );
    }
    settle.releaseClean();
    return undefined;
  };

  const resolveUnderKey = async (
    request: FinalizeRequest,
  ): Promise<FinalizeResult> => {
    const phase: UnitPhase = 'resolve';
    let connection: FinalizeConnection | undefined;
    try {
      connection = await options.executor.beginFinalization();
    } catch (error) {
      // Nothing leased: the executor disposes a client whose BEGIN fails.
      await abandon(request);
      return {
        ok: false,
        failure: classifyOperational(request, phase, 'not_committed', error),
      };
    }
    const settle = trackSettlement(connection);
    try {
      const keyFailure = await acquireKeyLock(request, connection, settle);
      if (keyFailure !== undefined) return keyFailure;
      const found = await connection.readReceipt(request.scopeId, request.internalKey);
      const settleError = await settle.abort();
      if (settleError !== undefined) {
        await abandon(request);
        return unknownOutcome(request, phase, { cause: 'resolve_settlement', settlement: settleError });
      }
      if (found === undefined) {
        await abandon(request);
        return {
          ok: false,
          failure: failure('provider_error', request, phase, 'not_committed', {
            lost: 'expected receipt after uniqueness violation',
          }, { variant: 'unclassified' }),
        };
      }
      if (found.codecVersion !== COMMAND_CODEC_VERSION) {
        // Settled above; the catch records abandonment before propagating.
        throw new CommitQuarantineError(request.scopeId, request.internalKey, found.codecVersion);
      }
      if (found.commandHash !== request.commandHash) {
        await abandon(request);
        return {
          ok: false,
          failure: failure('conflict', request, phase, 'not_committed', {
            key: request.internalKey,
          }, { variant: 'key_contention' }),
        };
      }
      return coordinator.replayGuarded(request);
    } catch (error) {
      if (error instanceof CommitQuarantineError) {
        return settleAndPropagateQuarantine(request, settle, error);
      }
      const settleError = await settle.abort();
      await abandon(request);
      if (settleError !== undefined) {
        return unknownOutcome(request, phase, { cause: error, settlement: settleError });
      }
      return {
        ok: false,
        failure: classifyOperational(request, phase, 'not_committed', error),
      };
    }
  };

  const coordinator: FinalizationCoordinator = {
    async finalize(request: FinalizeRequest): Promise<FinalizeResult> {
      validateRequest(request, 'finalize');
      await observeAt('before_connection_acquire', request.invocationId);
      let phase: UnitPhase = 'acquire';
      let connection: FinalizeConnection | undefined;
      try {
        await options.executor.ensureCoordinationRow(request.scopeId, request.internalKey);
        connection = await options.executor.beginFinalization();
      } catch (error) {
        // Nothing leased: the executor disposes a client whose BEGIN fails.
        await abandon(request);
        return {
          ok: false,
          failure: isConnectionLoss(error)
            ? failure('provider_unavailable', request, phase, 'not_committed', error)
            : classifyOperational(request, phase, 'not_committed', error),
        };
      }
      const active = connection;
      const settle = trackSettlement(active);
      try {
        phase = 'lock';
        await observeAt('before_key_lock', request.invocationId);
        const keyFailure = await acquireKeyLock(request, active, settle);
        if (keyFailure !== undefined) return keyFailure;
        const existing = await active.readReceipt(request.scopeId, request.internalKey);
        if (existing !== undefined) {
          const settleError = await settle.abort();
          if (settleError !== undefined) {
            await abandon(request);
            return unknownOutcome(request, phase, { cause: 'resolve_settlement', settlement: settleError });
          }
          if (existing.codecVersion !== COMMAND_CODEC_VERSION) {
            // Settled above; the catch records abandonment before propagating.
            throw new CommitQuarantineError(
              request.scopeId,
              request.internalKey,
              existing.codecVersion,
            );
          }
          if (existing.commandHash === request.commandHash) {
            return coordinator.replayGuarded(request);
          }
          await abandon(request);
          return {
            ok: false,
            failure: failure('conflict', request, 'lock', 'not_committed', {
              key: request.internalKey,
            }, { variant: 'key_contention' }),
          };
        }
        phase = 'guard';
        await observeAt('before_finalization_row_lock', request.invocationId);
        const transactionToken = randomUUID();
        const { transaction, minted } = bindTransaction(request, active, transactionToken);
        await runLockGroup(request, active, PRE_QUOTA_LOCK_CLASSES);
        // Authority re-read before the quota wait: A4.4 class order.
        await transaction.participant.readRevision();
        await runLockGroup(request, active, ['quota']);
        // Provisional quota reservation precedes the guard decision; the row
        // lock is retained through COMMIT and rolls back on denial.
        const reserved = await transaction.participant.reserveQuota({
          actorId: request.actorId,
          operation: request.operation,
        });
        if (!reserved.reserved) {
          return abortWith(
            request,
            phase,
            settle,
            {
              ok: false,
              failure: failure('conflict', request, 'guard', 'not_committed', {
                quota: 'exhausted',
              }, { variant: 'quota_exhausted' }),
            },
          );
        }
        await runLockGroup(request, active, ['blob-reference-deletion-claim']);
        await request.provisional?.(active);
        await observeAt('after_finalization_locks_before_guard', request.invocationId);
        const decision: ArtifactAuthorizationDecision = await request.guard(
          commitContext(request, 'finalize'),
          transaction,
        );
        if (!decision.allowed) {
          return abortWith(request, phase, settle, deny(request, decision));
        }
        const currentRevision = await transaction.participant.readRevision();
        const fenceCheck = verifyFence(request, transaction, minted, decision.fence, currentRevision);
        if (!fenceCheck.ok) {
          return abortWith(request, phase, settle, invalidFence(request, fenceCheck.detail));
        }
        if (currentRevision !== request.policyRevision) {
          return abortWith(request, phase, settle, revokedOutcome(request));
        }
        const receipt: StoredCommitReceipt = {
          scopeId: request.scopeId,
          internalKey: request.internalKey,
          commandHash: request.commandHash,
          codecVersion: request.codecVersion,
          receipt: request.receiptData,
          createdAt: new Date(nowMs()).toISOString(),
        };
        await active.insertReceipt(receipt);
        await request.finishIntents?.(active);
        await observeAt('before_commit', request.invocationId);
        // Run deferred constraint work inside the unit, before the final
        // decision: locks it acquires must not land during COMMIT.
        await active.query('SET CONSTRAINTS ALL IMMEDIATE', []);
        // Revalidate after the post-guard receipt/intent/barrier waits: a
        // revocation, expiry or foreign fence landing here denies instead of
        // committing an authorized-then-stale decision.
        const recheck = await request.guard(commitContext(request, 'finalize'), transaction);
        if (!recheck.allowed) {
          return abortWith(request, phase, settle, deny(request, recheck));
        }
        const recheckRevision = await transaction.participant.readRevision();
        const recheckFence = verifyFence(request, transaction, minted, recheck.fence, recheckRevision);
        if (!recheckFence.ok) {
          return abortWith(request, phase, settle, invalidFence(request, recheckFence.detail));
        }
        if (recheckRevision !== request.policyRevision) {
          return abortWith(request, phase, settle, revokedOutcome(request));
        }
        phase = 'commit';
        const commitFailure = await commitUnit(request, active, settle);
        if (commitFailure !== undefined) return commitFailure;
        return {
          ok: true,
          result: receipt,
          invocationId: request.invocationId,
          commitState: 'committed',
          replayed: false,
        };
      } catch (error) {
        if (error instanceof CommitQuarantineError) {
          return settleAndPropagateQuarantine(request, settle, error);
        }
        if (isUniqueViolation(error)) {
          await settle.abort();
          return resolveUnderKey(request);
        }
        if (phase === 'commit') {
          return unknownAfterCommitAttempt(request, settle, error);
        }
        const settleError = await settle.abort();
        await abandon(request);
        if (settleError !== undefined) {
          return unknownOutcome(request, phase, { cause: error, settlement: settleError });
        }
        return {
          ok: false,
          failure: classifyOperational(request, phase, 'not_committed', error),
        };
      }
    },

    async replayGuarded(request: FinalizeRequest): Promise<FinalizeResult> {
      validateRequest(request, 'replay');
      await observeAt('before_connection_acquire', request.invocationId);
      let phase: UnitPhase = 'acquire';
      let connection: FinalizeConnection | undefined;
      try {
        connection = await options.executor.beginFinalization();
      } catch (error) {
        // Nothing leased: the executor disposes a client whose BEGIN fails.
        await abandon(request);
        return {
          ok: false,
          failure: classifyOperational(request, phase, 'not_committed', error),
        };
      }
      const active = connection;
      const settle = trackSettlement(active);
      try {
        phase = 'lock';
        await observeAt('before_key_lock', request.invocationId);
        const replayKeyFailure = await acquireKeyLock(request, active, settle);
        if (replayKeyFailure !== undefined) return replayKeyFailure;
        const existing = await active.readReceipt(request.scopeId, request.internalKey);
        // Fires after the receipt lookup (not before): a revocation racing
        // the barrier denies on the looked-up row instead of vanishing it.
        await observeAt('after_replay_lookup_before_guard', request.invocationId);
        if (existing === undefined) {
          return abortWith(
            request,
            phase,
            settle,
            {
              ok: false,
              failure: failure('provider_error', request, phase, 'not_committed', {
                lost: 'replay without a success row',
              }, { variant: 'unclassified' }),
            },
          );
        }
        if (existing.codecVersion !== COMMAND_CODEC_VERSION) {
          const settleError = await settle.abort();
          if (settleError !== undefined) {
            await abandon(request);
            return unknownOutcome(request, phase, { settlement: settleError });
          }
          // Settled above; the catch records abandonment before propagating.
          throw new CommitQuarantineError(
            request.scopeId,
            request.internalKey,
            existing.codecVersion,
          );
        }
        if (existing.commandHash !== request.commandHash) {
          return abortWith(
            request,
            phase,
            settle,
            {
              ok: false,
              failure: failure('conflict', request, phase, 'not_committed', {
                key: request.internalKey,
              }, { variant: 'key_contention' }),
            },
          );
        }
        phase = 'guard';
        const transactionToken = randomUUID();
        const { transaction, minted } = bindTransaction(request, active, transactionToken);
        // Same key/object/ACL/policy lock order as finalization, without
        // quota charging, provisional publication writes or intent completion.
        await runLockGroup(request, active, PRE_QUOTA_LOCK_CLASSES);
        // Run deferred constraint work inside the unit, before the decision:
        // locks it acquires must not land during COMMIT.
        await active.query('SET CONSTRAINTS ALL IMMEDIATE', []);
        const decision = await request.guard(commitContext(request, 'replay'), transaction);
        if (!decision.allowed) {
          return abortWith(request, phase, settle, deny(request, decision));
        }
        const currentRevision = await transaction.participant.readRevision();
        const fenceCheck = verifyFence(request, transaction, minted, decision.fence, currentRevision);
        if (!fenceCheck.ok) {
          return abortWith(request, phase, settle, invalidFence(request, fenceCheck.detail));
        }
        if (currentRevision !== request.policyRevision) {
          return abortWith(request, phase, settle, revokedOutcome(request));
        }
        phase = 'commit';
        const commitFailure = await commitUnit(request, active, settle);
        if (commitFailure !== undefined) return commitFailure;
        return {
          ok: true,
          result: existing,
          invocationId: request.invocationId,
          commitState: 'committed',
          replayed: true,
        };
      } catch (error) {
        if (error instanceof CommitQuarantineError) {
          return settleAndPropagateQuarantine(request, settle, error);
        }
        if (phase === 'commit') {
          return unknownAfterCommitAttempt(request, settle, error);
        }
        const settleError = await settle.abort();
        await abandon(request);
        if (settleError !== undefined) {
          return unknownOutcome(request, phase, { cause: error, settlement: settleError });
        }
        return {
          ok: false,
          failure: classifyOperational(request, phase, 'not_committed', error),
        };
      }
    },
  };

  return coordinator;
}
