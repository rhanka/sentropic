/**
 * L5 (immo #861) — guarded ensure replay (spec r2 §§3.1 A5/A7, 3.2).
 *
 * Ensure-domain adapter over the L3 finalization coordinator: replay goes
 * through replayGuarded with the request-bound guard, never through a raw
 * receipt read. A stored success replays only while currently authorized,
 * without a quota recharge (the coordinator runs the pre-quota lock groups
 * on the replay path). Unknown legacy codecs propagate as quarantine for
 * the L6 migration projection.
 */
import type {
  ArtifactCommitCoordinator,
  FinalizeRequest,
  FinalizeResult,
  InternalIdempotencyKey,
  StoredCommitReceipt,
} from './commit/types.js';
import type { ArtifactInvocationContext } from './commit/types.js';

/** Durable ensure receipt carried by the success record. */
export interface EnsureReceipt {
  readonly artifactId: string;
  readonly created: boolean;
}

/** Guarded replay input: durable key plus the effective command hash. */
export interface GuardedReplayInput {
  readonly invocation: ArtifactInvocationContext;
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly policyRevision: string;
  readonly locks?: FinalizeRequest['locks'];
  readonly artifactId?: string;
  readonly bindingName?: string;
  readonly validateReplayReceipt?: FinalizeRequest['validateReplayReceipt'];
  readonly noteAbandonedAttempt?: FinalizeRequest['noteAbandonedAttempt'];
}

/** Replay one ensure through the coordinator with the request-bound guard. */
export async function replayEnsureGuarded(
  coordinator: ArtifactCommitCoordinator,
  input: GuardedReplayInput,
): Promise<FinalizeResult> {
  return coordinator.replayPrepared({
    scopeId: input.invocation.storageScopeId,
    internalKey: input.internalKey,
    commandHash: input.commandHash,
    codecVersion: 'artifacts-command/v1',
    invocationId: input.invocation.invocationId,
    actorId: input.invocation.actorId,
    operation: 'ensure',
    // The binding lock resolves the target before the coordinator builds its guard context.
    get artifactId() { return input.artifactId ?? null; },
    bindingName: input.bindingName ?? null,
    policyRevision: input.policyRevision,
    locks: input.locks,
    guard: input.invocation.authorizeCommit,
    receiptData: undefined,
    validateReplayReceipt: input.validateReplayReceipt,
    noteAbandonedAttempt: input.noteAbandonedAttempt,
    attemptId: input.invocation.invocationId,
  });
}

/** Project a stored ensure receipt; rejects rows that are not ensure receipts. */
export function projectEnsureReceipt(receipt: StoredCommitReceipt): EnsureReceipt {
  const data = receipt.receipt as Partial<EnsureReceipt> | undefined;
  if (typeof data?.artifactId !== 'string' || data.artifactId.length === 0 ||
    typeof data?.created !== 'boolean') {
    throw new Error('ensure receipt mismatch');
  }
  return { artifactId: data.artifactId, created: data.created };
}
