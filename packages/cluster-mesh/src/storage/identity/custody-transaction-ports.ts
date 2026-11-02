import type { IdentityTransactionV1, IdentityDeletionAttemptV2 } from '../../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import { IdentityNotFoundError } from '../../identity-contracts/errors.js';
import type { CustodyOpHost } from './custody-host.js';
import type { PgSession, SqlValue } from '../postgres/protocol.js';
import type { SqliteConnection } from '../sqlite/connection.js';

export const boundIdentitySql = (host: CustodyOpHost) => ({
  table: (name: string): string => host.profile === 'postgres' ? `"${(host as CustodyOpHost & { schema: string }).schema}"."${name}"` : `"${name}"`,
  query: async (text: string, values: readonly SqlValue[] = []): Promise<readonly Record<string, unknown>[]> => {
    if (host.profile === 'postgres') {
      let index = 0;
      return (await (host.raw as PgSession).execute({ text: text.replace(/\?/g, () => `$${++index}`), values })).rows;
    }
    return (host.raw as SqliteConnection).prepare(text).all(...values as never[]);
  },
});

export const transactionOperationPorts = (host: CustodyOpHost, requireWrite: () => void): Pick<IdentityTransactionV1<CustodyOpHost>,
  'deletionJournal' | 'revocationOutbox' | 'cleanup' | 'lockSubject' | 'lockWorkspace' | 'lockEmail' | 'advanceSubjectRevision'> => {
  const journal = host.journal;
  const sql = boundIdentitySql(host);
  const lock = async (kind: string, id: string): Promise<void> => {
    requireWrite();
    if (!id) throw new IdentityCustodyErrorV1('identity_material_invalid');
    if (host.profile === 'postgres') await sql.query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [JSON.stringify([kind, id])]);
  };
  return {
    lockSubject: async (userId) => {
      await lock('subject', userId);
      const [fence] = await sql.query(`SELECT * FROM ${sql.table('identity_subject_fences')} WHERE user_id = ?${host.profile === 'postgres' ? ' FOR UPDATE' : ''}`, [userId]);
      if (fence?.retired_at != null) throw new IdentityCustodyErrorV1('identity_subject_retired');
      if (!await journal.findAccountCore(userId)) throw new IdentityNotFoundError('user', userId);
      if (!fence) throw new IdentityCustodyErrorV1('identity_material_missing');
    },
    lockWorkspace: async (id) => {
      await lock('workspace', id);
      if (!await journal.findWorkspaceCore(id)) throw new IdentityNotFoundError('workspace', id);
    },
    lockEmail: async (email) => {
      if (email !== email.trim().toLowerCase() || !email.includes('@')) throw new IdentityCustodyErrorV1('identity_material_invalid');
      await lock('email', email);
    },
    advanceSubjectRevision: async (userId, at, retire) => {
      requireWrite();
      const rows = await sql.query(`UPDATE ${sql.table('identity_subject_fences')} SET revision = revision + 1, updated_at = ?, retired_at = ?
        WHERE user_id = ? AND retired_at IS NULL AND revision < 9007199254740991 RETURNING user_id`, [at, retire ? at : null, userId]);
      if (!rows.length) throw new IdentityCustodyErrorV1('identity_subject_retired');
    },
    deletionJournal: {
      reserve: async (record) => { requireWrite(); await lock('operation', record.operationId); await journal.reserveOperation(record); return (await journal.findOperation(record.operationId))!; },
      find: (id) => journal.findOperation(id),
      lock: async (id) => { await lock('operation', id); return journal.findOperation(id); },
      markCommitted: (id, receipt) => { requireWrite(); return journal.markOperationCommitted(id, receipt, receipt.at); },
      appendRolledBack: (attemptId, receipt) => { requireWrite(); return journal.appendAttempt({ attemptId, operationId: receipt.operationId, at: receipt.at, receipt }); },
      listAttempts: async (id) => (await sql.query(`SELECT * FROM ${sql.table('identity_deletion_attempts')} WHERE operation_id = ? ORDER BY at, attempt_id`, [id]))
        .map((row): IdentityDeletionAttemptV2 => ({ attemptId: String(row.attempt_id), operationId: id, at: String(row.at), receipt: JSON.parse(String(row.receipt_json)) })),
    },
    revocationOutbox: {
      enqueue: (record) => { requireWrite(); return journal.enqueueDelivery(record); },
      find: (id) => journal.findDelivery(id),
      listPending: (id) => journal.listPendingByOperation(id),
      claimPending: async (input) => {
        requireWrite();
        return (await journal.claimPending(input.now, input.workerId, input.leaseUntil, input.limit))
          .map((record) => ({ record, workerId: input.workerId, claimVersion: record.claimVersion }));
      },
      acknowledge: (input) => { requireWrite(); return journal.acknowledgeDelivery(input.deliveryId, input.workerId, input.claimVersion, input.at); },
      release: async (input) => {
        requireWrite();
        const row = await journal.findDelivery(input.deliveryId);
        if (!row || row.state !== 'pending' || row.claimOwner !== input.workerId || row.claimVersion !== input.claimVersion || !row.leaseUntil || row.leaseUntil <= input.at) {
          throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
        }
        return journal.releaseClaim(input.deliveryId, input.workerId, input.claimVersion, input.nextAttemptAt);
      },
    },
    cleanup: {
      deleteSubjectReferences: async ({ userId, accountEmail, workspaceIdsToDelete }) => {
        requireWrite();
        const deletedByTable: Record<string, number> = {};
        deletedByTable.memberships = await journal.deleteMembershipsForUser(userId);
        deletedByTable.workspaceMembers = await journal.deleteWorkspaceMembersForUser(userId);
        await journal.deleteWorkspaceMembersIn(workspaceIdsToDelete);
        await journal.deleteConsentsForUser(userId);
        await journal.deleteConversationsForUser(userId);
        await journal.deleteProofsForUser(userId);
        await journal.deleteDeviceCodesForUser(userId);
        await journal.deleteSessionsForUser(userId);
        Object.assign(deletedByTable, await journal.cleanupCustodyForUser(userId, accountEmail ?? ''));
        const detachedByTable = { invitationConsumers: await journal.detachInvitationConsumer(userId) };
        if (accountEmail) await journal.revokePendingInvitationsForEmail(accountEmail);
        for (const id of workspaceIdsToDelete) { await journal.detachInvitationWorkspace(id); await journal.deleteWorkspace(id); }
        return { deletedByTable, detachedByTable, remainingLiveReferences: 0 };
      },
      assertNoLiveReferences: (input) => journal.assertNoLiveReferences({ ...input, accountEmail: input.accountEmail ?? '' }),
    },
  };
};
