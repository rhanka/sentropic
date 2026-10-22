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
  COMMIT_LOCK_ORDER,
  CommitQuarantineError,
  FAILURE_PROJECTIONS,
  type ArtifactAuthorizationDecision,
  type ArtifactCommitContext,
  type ArtifactCommitCoordinator,
  type ArtifactCommitTransaction,
  type ArtifactFailure,
  type CommitCoordinatorOptions,
  type CommitExecutor,
  type CommitLockClass,
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
  overrides?: { publicCode?: string; status?: number; retriable?: boolean },
): ArtifactFailure {
  const table = FAILURE_PROJECTIONS.find((entry) => entry.category === category);
  if (table === undefined) throw new Error(`unknown failure category ${category}`);
  return {
    category,
    httpStatus: overrides?.status ?? table.httpStatus,
    publicCode: overrides?.publicCode ?? table.publicCode,
    retriable: overrides?.retriable ?? table.retriable,
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

export function createArtifactCommitCoordinator(options: CommitCoordinatorOptions): ArtifactCommitCoordinator {
  const nowMs = options.nowMs ?? (() => Date.now());
  const observe = options.testObserver;

  const commitContext = (
    request: FinalizeRequest,
    purpose: 'finalize' | 'replay',
  ): ArtifactCommitContext => ({
    invocationId: request.invocationId,
    actorId: request.actorId,
    storageScopeId: request.scopeId,
    authorizeCommit: request.guard,
    operation: request.operation,
    artifactId: request.artifactId ?? null,
    bindingName: request.bindingName ?? null,
    internalKey: request.internalKey,
    commandHash: request.commandHash,
    codecVersion: request.codecVersion,
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
          }),
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
          }),
        };
      }
      return coordinator.replayGuarded(request);
    } catch (error) {
      if (error instanceof CommitQuarantineError) {
        try {
          await connection.rollback();
        } catch {
          // Rollback best effort; the quarantine cause is preserved.
        }
        connection.release();
        throw error;
      }
      throw error;
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
      { publicCode: decision.publicCode, status: decision.status, retriable: decision.retriable },
    ),
  });

  const runCallerLocks = async (
    request: FinalizeRequest,
    connection: FinalizeConnection,
  ): Promise<void> => {
    for (const lockClass of COMMIT_LOCK_ORDER) {
      const callbacks = request.locks?.[lockClass as CommitLockClass];
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
    await observe?.('after_finalization_locks_before_guard', request.invocationId);
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
    if (decision.fence.transactionToken !== transaction.id) {
      await connection.rollback();
      connection.release();
      return {
        ok: false,
        failure: failure('unauthorized_at_commit', request, 'guard', 'not_committed', {
          denialReason: 'invalid_object',
        }),
      };
    }
    const currentRevision = await transaction.participant.readRevision();
    if (currentRevision !== decision.fence.revision) {
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
          { publicCode: 'access_denied', status: 403, retriable: false },
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
        }),
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
    await observe?.('before_commit', request.invocationId);
    try {
      await connection.commit();
    } catch (error) {
      if (isConnectionLoss(error)) {
        try {
          connection.release();
        } catch {
          // The connection is already lost; the unknown cause is preserved.
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
      result: { receipt, replayed: false, invocationId: request.invocationId, commitState: 'committed' },
    };
  };

  const coordinator: ArtifactCommitCoordinator = {
    async finalize(request: FinalizeRequest): Promise<FinalizeResult> {
      if (request.scopeId.length === 0 || request.internalKey.length === 0) {
        throw new Error('finalize requires scope and internal key');
      }
      if (request.commandHash.length === 0 || request.codecVersion.length === 0) {
        throw new Error('finalize requires command hash and codec version');
      }
      await observe?.('before_connection_acquire', request.invocationId);
      await options.executor.ensureCoordinationRow(request.scopeId, request.internalKey);
      const connection = await options.executor.beginFinalization();
      try {
        await observe?.('before_key_lock', request.invocationId);
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
            }),
          };
        }
        await observe?.('before_finalization_row_lock', request.invocationId);
        await runCallerLocks(request, connection);
        await request.provisional?.(connection);
        const transactionToken = randomUUID();
        const transaction: ArtifactCommitTransaction = {
          id: transactionToken,
          invocationId: request.invocationId,
          participant: options.policy.createParticipant(connection, transactionToken),
        };
        return await guardAndCommit(request, connection, transaction, 'finalize');
      } catch (error) {
        if (error instanceof CommitQuarantineError) throw error;
        if (isUniqueViolation(error)) {
          try {
            await connection.rollback();
          } catch {
            // Rollback best effort before resolving under the same key.
          }
          connection.release();
          return resolveUnderKey(request);
        }
        const loss = isConnectionLoss(error);
        try {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure(
              (error as { code?: unknown }).code === LOCK_TIMEOUT_CODE || loss
                ? 'provider_unavailable'
                : 'provider_error',
              request,
              'finalize',
              'not_committed',
              error,
            ),
          };
        } catch (rollbackError) {
          try {
            connection.release();
          } catch {
            // Release best effort; the chained cause is preserved below.
          }
          return {
            ok: false,
            failure: failure('provider_unavailable', request, 'finalize', 'unknown', {
              cause: error,
              rollback: rollbackError,
            }),
          };
        }
      }
    },

    async replayGuarded(request: FinalizeRequest): Promise<FinalizeResult> {
      await observe?.('before_connection_acquire', request.invocationId);
      const connection = await options.executor.beginFinalization();
      try {
        await observe?.('before_key_lock', request.invocationId);
        await connection.lockOperationKey(request.scopeId, request.internalKey);
        await observe?.('after_replay_lookup_before_guard', request.invocationId);
        const existing = await connection.readReceipt(request.scopeId, request.internalKey);
        if (existing === undefined) {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure('provider_error', request, 'replay', 'not_committed', {
              lost: 'replay without a success row',
            }),
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
            }),
          };
        }
        const transactionToken = randomUUID();
        const transaction: ArtifactCommitTransaction = {
          id: transactionToken,
          invocationId: request.invocationId,
          participant: options.policy.createParticipant(connection, transactionToken),
        };
        const decision = await request.guard(commitContext(request, 'replay'), transaction);
        if (!decision.allowed) {
          await connection.rollback();
          connection.release();
          return deny(request, decision);
        }
        if (decision.fence.transactionToken !== transaction.id) {
          await connection.rollback();
          connection.release();
          return {
            ok: false,
            failure: failure('unauthorized_at_commit', request, 'replay', 'not_committed', {
              denialReason: 'invalid_object',
            }),
          };
        }
        await connection.commit();
        connection.release();
        return {
          ok: true,
          result: {
            receipt: existing,
            replayed: true,
            invocationId: request.invocationId,
            commitState: 'committed',
          },
        };
      } catch (error) {
        if (error instanceof CommitQuarantineError) throw error;
        try {
          await connection.rollback();
        } catch {
          // Rollback best effort; the original cause is preserved below.
        }
        connection.release();
        return {
          ok: false,
          failure: failure(
            isConnectionLoss(error) ? 'provider_unavailable' : 'provider_error',
            request,
            'replay',
            'not_committed',
            error,
          ),
        };
      }
    },
  };

  return coordinator;
}
