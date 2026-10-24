import { describe, expect, it } from 'vitest';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import type { CommitBarrierObserver, CommitBarrierPoint } from '../l0-freeze/commit-contract.js';
import type {
  CommitCoordinatorOptions, FinalizeConnection, FinalizeRequest, StoredCommitReceipt,
} from '../src/server/commit/types.js';

function setup(testObserver: CommitBarrierObserver, testPoints?: CommitCoordinatorOptions['testPoints']) {
  let receipt: StoredCommitReceipt | undefined;
  const connection: FinalizeConnection = {
    query: async () => ({ rows: [], rowCount: 0 }),
    beginReadCommitted: async () => {},
    lockOperationKey: async () => {},
    readReceipt: async () => receipt,
    insertReceipt: async (value) => { receipt = value; },
    commit: async () => {}, rollback: async () => {}, release: () => {},
  };
  return createArtifactCommitCoordinator({
    executor: {
      ensureCoordinationRow: async () => {},
      beginFinalization: async () => connection,
    },
    policy: {
      createParticipant: (_client, transactionId) => ({
        readRevision: async () => 'rev-1',
        checkApproval: async () => ({ approved: true }),
        reserveQuota: async () => ({ reserved: true }),
        mintFence: (policyRevision, invocationId) => ({
          transactionId, fenceId: 'fence', policyRevision, invocationId,
        }),
      }),
    },
    testObserver, testPoints,
  });
}

const request: FinalizeRequest = {
  scopeId: 'scope', internalKey: 'key' as FinalizeRequest['internalKey'],
  commandHash: 'hash', codecVersion: 'artifacts-command/v1',
  invocationId: 'finalize', actorId: 'actor', operation: 'publish',
  artifactId: null, bindingName: null, policyRevision: 'rev-1', receiptData: {},
  guard: async (context, transaction) => ({
    allowed: true,
    fence: transaction.participant.mintFence(context.policyRevision, context.invocationId),
  }),
};

describe('frozen observer compatibility', () => {
  it.each([undefined, ['before_commit'] as const])(
    'should observe successful finalization and replay with points %j', async (testPoints) => {
      const arrivals: Array<[CommitBarrierPoint, string]> = [];
      const observer: CommitBarrierObserver = {
        arrive: (point, invocationId) => { arrivals.push([point, invocationId]); },
      };
      const coordinator = setup(observer, testPoints);
      expect(await coordinator.finalize(request)).toMatchObject({ ok: true, replayed: false });
      expect(await coordinator.replayGuarded({ ...request, invocationId: 'replay' }))
        .toMatchObject({ ok: true, replayed: true });
      expect(arrivals.filter(([, id]) => id === 'finalize').map(([point]) => point)).toEqual(
        testPoints ?? ['before_connection_acquire', 'before_key_lock', 'before_finalization_row_lock',
          'after_finalization_locks_before_guard', 'before_commit'],
      );
      expect(arrivals.filter(([, id]) => id === 'replay').map(([point]) => point)).toEqual(
        testPoints === undefined
          ? ['before_connection_acquire', 'before_key_lock', 'after_replay_lookup_before_guard'] : [],
      );
    },
  );
});
