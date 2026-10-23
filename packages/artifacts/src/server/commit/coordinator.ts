/**
 * L3 (immo #861) — atomic finalization coordinator (spec r2 §3.1 A4).
 *
 * One atomic database finalization unit per (scope, internal key):
 * coordination row, key recheck, ordered locks, provisional writes, the
 * host guard after all waits, fenced final predicate, single success
 * insert and one COMMIT. Denial or genuine conflict rolls the unit back
 * with no committed residue. A connection loss around COMMIT
 * acknowledgment is a separate unknown outcome recovered by retrying the
 * same key. The success table is distinct from idempotency_keys, which
 * the coordinator never touches.
 */
import { randomUUID } from 'node:crypto';
import {
  COMMAND_CODEC_VERSION,
  PARTICIPANT_LOCK_ORDER,
  CommitQuarantineError,
  FAILURE_PROJECTIONS,
  type ArtifactAuthorizationDecision,
  type ArtifactCommitContext,
  type FinalizationCoordinator,
  type ArtifactCommitTransaction,
  type ArtifactFailure,
  type CommitCoordinatorOptions,
  type CommitExecutor,
  type ParticipantLockClass,
  type CoordinatorTestPoint,
  type FailureCategory,
  type FinalizeConnection,
  type FinalizeRequest,
  type FinalizeResult,
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

const CONNECTION_LOSS_CODES = new Set(['57P06', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);

const isConnectionLoss = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return (
    (typeof code === 'string' && (CONNECTION_LOSS_CODES.has(code) || code.startsWith('08'))) ||
    /terminating connection|connection reset|connection refused/i.test(String(error))
  );
};

const LOCK_TIMEOUT_CODE = '55P03';

export function createArtifactCommitCoordinator(options: CommitCoordinatorOptions): FinalizationCoordinator {
  const nowMs = options.nowMs ?? (() => Date.now());
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

  const resolveUnderKey = async (
    request: FinalizeRequest,
  ): Promise<FinalizeResult> => {
    const connection = await options.executor.beginFinalization();
    try {
      await connection.lockOperationKey(request.scopeId, request.internalKey);
      const found = await connection.readReceipt(request.scopeId, request.internalKey);
      await connection.rollback();
      connection.release();
      if (found === undefined) {
        return {
          ok: false,
          failure: failure('provider_error', request, 'resolve', 'not_committed', {
            lost: 'expected receipt after uniqueness violation',
          }, { variant: 'unclassified' }),
        };
      }
      if (found.codecVersion !== COMMAND_CODEC_VERSION) {
        throw new CommitQuarantineError(request.scopeId, request.internalKey, found.codecVersion);
      }
      if (found.commandHash !== request.commandHash) {
        return {
          ok: false,
          failure: failure('conflict', request, 'resolve', 'not_committed', {
            key: request.internalKey,
          }, { variant: 'key_contention' }),
        };
      }
      return coordinator.replayGuarded(request);
    } catch (error) {
      if (error instanceof CommitQuarantineError) {
        await settleAfterError(connection);
        throw error;
      }
      throw error;
    }
  };

  const settleAfterError = async (
    connection: FinalizeConnection,
  ): Promise<unknown | undefined> => {
    try {
      await connection.rollback();
      connection.release();
      return undefined;
    } catch (rollbackError) {
      connection.release(rollbackError);
      return rollbackError;
    }
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

  const runCallerLocks = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
  ): Promise<void> => {
    for (const lockClass of PARTICIPANT_LOCK_ORDER) {
      const callbacks = request.locks?.[lockClass as ParticipantLockClass];
      if (callbacks === undefined) continue;
      for (const acquire of callbacks) await acquire(connection);
    }
  };

  const guardAndCommit = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
    transaction: ArtifactCommitTransaction,
    purpose: 'finalize',
  ): Promise<FinalizeResult> => {
    await observeAt('after_finalization_locks_before_guard', request.invocationId);
    const decision: ArtifactAuthorizationDecision = await request.guard(
      commitContext(request, purpose),
      transaction,
    );
    if (!decision.allowed) {
      await connection.rollback();
      connection.release();
      await request.noteAbandonedAttempt?.(request.attemptId ?? request.internalKey);
      return deny(request, decision);
    }
    if (decision.fence.invocationId !== request.invocationId) {
      await connection.rollback();
      connection.release();
      return {
        ok: false,
        failure: failure('unauthorized_at_commit', request, 'guard', 'not_committed', {
          denialReason: 'invalid_object',
        }, { variant: 'policy_denial' }),
      };
    }
    const currentRevision = await transaction.participant.readRevision();
    if (currentRevision !== decision.fence.policyRevision) {
      await connection.rollback();
      connection.release();
      await request.noteAbandonedAttempt?.(request.attemptId ?? request.internalKey);
      return {
        ok: false,
        failure: failure(
          'unauthorized_at_commit',
          request,
          'guard',
          'not_committed',
          { denialReason: 'revoked' as const },
          { publicCode: 'access_denied', status: 403, retriable: false, variant: 'policy_denial' },
        ),
      };
    }
    const reserved = await transaction.participant.reserveQuota({
      actorId: request.actorId,
      operation: request.operation,
    });
    if (!reserved.reserved) {
      await connection.rollback();
      connection.release();
      await request.noteAbandonedAttempt?.(request.attemptId ?? request.internalKey);
      return {
        ok: false,
        failure: failure('conflict', request, 'guard', 'not_committed', {
          quota: 'exhausted',
        }, { variant: 'key_contention' }),
      };
    }
    const receipt: StoredCommitReceipt = {
      scopeId: request.scopeId,
      internalKey: request.internalKey,
      commandHash: request.commandHash,
      codecVersion: request.codecVersion,
      receipt: request.receiptData,
      createdAt: new Date(nowMs()).toISOString(),
    };
    await connection.insertReceipt(receipt);
    await request.finishIntents?.(connection);
    await observeAt('before_commit', request.invocationId);
    try {
      await connection.commit();
    } catch (error) {
      if (isConnectionLoss(error)) {
        try {
          await connection.rollback();
          connection.release();
        } catch (rollbackError) {
          connection.release(rollbackError);
        }
        return {
          ok: false,
          failure: failure('provider_unavailable', request, 'commit', 'unknown', error),
        };
      }
      throw error;
    }
    connection.release();
    return {
      ok: true,
      result: receipt,
      invocationId: request.invocationId,
      commitState: 'committed',
      replayed: false,
    };
  };

  const coordinator: FinalizationCoordinator = {
    async finalize(request: FinalizeRequest): Promise<FinalizeResult> {
      if (request.scopeId.length === 0 || request.internalKey.length === 0) {
        throw new Error('finalize requires scope and internal key');
      }
      if (request.commandHash.length === 0 || request.codecVersion.length === 0) {
        throw new Error('finalize requires command hash and codec version');
      }
      await observeAt('before_connection_acquire', request.invocationId);
      await options.executor.ensureCoordinationRow(request.scopeId, request.internalKey);
      const connection = await options.executor.beginFinalization();
      try {
        await observeAt('before_key_lock', request.invocationId);
        await connection.lockOperationKey(request.scopeId, request.internalKey);
        const existing = await connection.readReceipt(request.scopeId, request.internalKey);
        if (existing !== undefined) {
          if (existing.codecVersion !== COMMAND_CODEC_VERSION) {
            await connection.rollback();
            connection.release();
            throw new CommitQuarantineError(
              request.scopeId,
              request.internalKey,
              existing.codecVersion,
            );
          }
          await connection.rollback();
          connection.release();
          await request.noteAbandonedAttempt?.(request.attemptId ?? request.internalKey);
          if (existing.commandHash === request.commandHash) {
            return coordinator.replayGuarded(request);
          }
          return {
            ok: false,
            failure: failure('conflict', request, 'lock', 'not_committed', {
              key: request.internalKey,
            }, { variant: 'key_contention' }),
          };
        }
        await observeAt('before_finalization_row_lock', request.invocationId);
        await runCallerLocks(request, connection);
        await request.provisional?.(connection);
        const transactionToken = randomUUID();
        const transaction: ArtifactCommitTransaction = {
          transactionId: transactionToken,
          invocationId: request.invocationId,
          policyRevision: request.policyRevision,
          participant: options.policy.createParticipant(connection, transactionToken),
        };
        return await guardAndCommit(request, connection, transaction, 'finalize');
      } catch (error) {
        if (error instanceof CommitQuarantineError) throw error;
        if (isUniqueViolation(error)) {
          await settleAfterError(connection);
          return resolveUnderKey(request);
        }
        const loss = isConnectionLoss(error);
        const rollbackError = await settleAfterError(connection);
        if (rollbackError === undefined) {
          const unavailable =
            (error as { code?: unknown }).code === LOCK_TIMEOUT_CODE || loss;
          return {
            ok: false,
            failure: failure(
              unavailable ? 'provider_unavailable' : 'provider_error',
              request,
              'finalize',
              'not_committed',
              error,
              { variant: unavailable ? 'dispatch_failure' : 'unclassified' },
            ),
          };
        }
        return {
          ok: false,
          failure: failure('provider_unavailable', request, 'finalize', 'unknown', {
            cause: error,
            rollback: rollbackError,
          }),
        };
      }
    },

    async replayGuarded(request: FinalizeRequest): Promise<FinalizeResult> {
      await observeAt('before_connection_acquire', request.invocationId);
      const connection = await options.executor.beginFinalization();
      try {
        await observeAt('before_key_lock', request.invocationId);
        await connection.lockOperationKey(request.scopeId, request.internalKey);
        await observeAt('after_replay_lookup_before_guard', request.invocationId);
        const existing = await connection.readReceipt(request.scopeId, request.internalKey);
        if (existing === undefined) {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure('provider_error', request, 'replay', 'not_committed', {
              lost: 'replay without a success row',
            }, { variant: 'unclassified' }),
          };
        }
        if (existing.codecVersion !== COMMAND_CODEC_VERSION) {
          await connection.rollback();
          connection.release();
          throw new CommitQuarantineError(request.scopeId, request.internalKey, existing.codecVersion);
        }
        if (existing.commandHash !== request.commandHash) {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure('conflict', request, 'replay', 'not_committed', {
              key: request.internalKey,
            }, { variant: 'key_contention' }),
          };
        }
        const transactionToken = randomUUID();
        const transaction: ArtifactCommitTransaction = {
          transactionId: transactionToken,
          invocationId: request.invocationId,
          policyRevision: request.policyRevision,
          participant: options.policy.createParticipant(connection, transactionToken),
        };
        const decision = await request.guard(commitContext(request, 'replay'), transaction);
        if (!decision.allowed) {
          await connection.rollback();
          connection.release();
          return deny(request, decision);
        }
        if (decision.fence.invocationId !== request.invocationId) {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure('unauthorized_at_commit', request, 'replay', 'not_committed', {
              denialReason: 'invalid_object',
            }, { variant: 'policy_denial' }),
          };
        }
        await connection.commit();
        connection.release();
        return {
          ok: true,
          result: existing,
          invocationId: request.invocationId,
          commitState: 'committed',
          replayed: true,
        };
      } catch (error) {
        if (error instanceof CommitQuarantineError) throw error;
        const rollbackError = await settleAfterError(connection);
        if (rollbackError === undefined) {
          const unavailable = isConnectionLoss(error);
          return {
            ok: false,
            failure: failure(
              unavailable ? 'provider_unavailable' : 'provider_error',
              request,
              'replay',
              'not_committed',
              error,
              { variant: unavailable ? 'dispatch_failure' : 'unclassified' },
            ),
          };
        }
        return {
          ok: false,
          failure: failure('provider_unavailable', request, 'replay', 'unknown', {
            cause: error,
            rollback: rollbackError,
          }),
        };
      }
    },
  };

  return coordinator;
}
