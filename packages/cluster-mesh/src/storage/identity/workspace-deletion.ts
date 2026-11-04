// A4 composition bundle 1.2.0 — atomic standalone workspace deletion (P5):
// one write UOW attempt, all-or-rollback, no durable operation journal (the
// command is safely retryable and nothing is enqueued before commit).
// Host-generic per the shared rule: CM-internal state comes from
// identityTransactionHost(tx), never from tx.hostTransaction; host ports
// (business, authorization, plane) receive the unaltered transaction.

import type {
  AtomicWorkspaceDeletionV1,
  WorkspaceDeletionCommandV1,
  WorkspaceDeletionInputV1,
  WorkspaceDeletionReceiptV1,
} from '../../identity-contracts/workspace-deletion.js';
import type {
  IdentityExternalRevocationV1,
  IdentityTransactionV1,
} from '../../identity-contracts/custody.js';
import type { IdentityCleanupReceiptV1 } from '../../identity-contracts/custody-operations.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import { IdentityNotFoundError } from '../../identity-contracts/errors.js';
import { boundIdentitySql } from './custody-transaction-ports.js';
import { identityDeliveryId } from './custody-import-deliveries.js';
import { identityTransactionHost, requireIdentityRunOptions } from './custody-transaction-guards.js';

const CONNECTOR_STEP = 'connector_grants';

const validateComposition = <H>(input: WorkspaceDeletionInputV1<H>): void => {
  const plane = input.connectorPlane;
  if (!input.business?.deleteWorkspaceRows || !input.business.assertNoWorkspaceOrphans
    || !input.authorization?.assertAllowed || !input.clock
    || !plane?.listConnectorOwners || !plane.apply || !plane.assertDeliveryInScope || !plane.assertAbsent
    || !['present', 'absent'].includes(plane.placement)) {
    throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  }
  if (plane.placement === 'present' && !input.connectorCustody) {
    throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  }
  requireIdentityRunOptions(input.transactionOptions.deletion);
  if (input.transactionOptions.deletion.mode !== 'write' || input.transactionOptions.deletion.purpose !== 'delete') {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

export const createAtomicWorkspaceDeletionV1 = <H>(input: WorkspaceDeletionInputV1<H>): AtomicWorkspaceDeletionV1 => {
  validateComposition(input);
  const deleteWorkspace = async (command: WorkspaceDeletionCommandV1): Promise<WorkspaceDeletionReceiptV1> => {
    if (!command.operationId || !command.workspaceId || !command.actorId) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    const at = input.clock();
    return input.unitOfWork.run(input.transactionOptions.deletion, async (tx: IdentityTransactionV1<H>) => {
      const host = identityTransactionHost(tx);
      const journal = host.journal;
      const sql = boundIdentitySql(host);
      // Lock order (r6 §5.2): operation key, then subjects, then workspace.
      await tx.deletionJournal.lock(command.operationId);
      const owners = input.connectorPlane.placement === 'present' ? await input.connectorPlane.listConnectorOwners(command, tx) : [];
      for (const userId of [...new Set([command.actorId, ...owners])].sort()) await tx.lockSubject(userId);
      await tx.lockWorkspace(command.workspaceId);
      // CM-side authority recheck under the locks.
      const workspace = await journal.findWorkspaceCore(command.workspaceId);
      if (!workspace) throw new IdentityNotFoundError('workspace', command.workspaceId);
      const membership = await tx.stores.workspaceMembers.findWorkspaceMember(command.workspaceId, command.actorId);
      if (!membership || membership.role !== 'admin') throw new IdentityCustodyErrorV1('identity_workspace_admin_required');
      await input.authorization.assertAllowed(command, tx);
      await tx.stores.audit.append({ at, kind: 'workspace_deletion', actorId: command.actorId, subjectId: command.workspaceId, detail: command.operationId });
      // Connector plane: the plane captures each in-workspace row per owner.
      const deliveryIds: string[] = [];
      if (input.connectorPlane.placement === 'present') {
        for (const draft of await input.connectorPlane.apply(command, tx)) {
          if (draft.step !== CONNECTOR_STEP || draft.targetKind !== 'connector_grant' || !draft.subjectId || !draft.targetRef || !draft.custodyRef) {
            throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
          }
          await input.connectorPlane.assertDeliveryInScope(command, draft, tx);
          const deliveryId = identityDeliveryId(command.operationId, draft.step, draft.targetKind, draft.targetRef);
          const record: IdentityExternalRevocationV1 = { ...draft, deliveryId, operationId: command.operationId, state: 'pending', createdAt: at, nextAttemptAt: at, deliveredAt: null, claimOwner: null, claimVersion: 0, leaseUntil: null, attemptCount: 0 };
          await tx.revocationOutbox.enqueue(record);
          await input.connectorCustody!.assertCaptured(record, tx);
          deliveryIds.push(deliveryId);
        }
      } else {
        await input.connectorPlane.assertAbsent(command, tx);
      }
      // Business rows on the host transaction, then CM cleanup primitives.
      const business = await input.business.deleteWorkspaceRows(command.workspaceId, tx);
      const deletedByTable: Record<string, number> = {};
      deletedByTable.workspaceMembers = await journal.deleteWorkspaceMembersIn([command.workspaceId]);
      const sessions = await sql.query(`SELECT COUNT(*) AS c FROM ${sql.table('cm_identity_conversation_sessions')} WHERE workspace_id = ?`, [command.workspaceId]);
      deletedByTable.conversationSessions = Number(sessions[0]?.['c'] ?? 0);
      await sql.query(`DELETE FROM ${sql.table('cm_identity_conversation_sessions')} WHERE workspace_id = ?`, [command.workspaceId]);
      const detachedByTable: Record<string, number> = {};
      detachedByTable.invitationDigests = await journal.detachInvitationWorkspace(command.workspaceId);
      await journal.deleteWorkspace(command.workspaceId);
      deletedByTable.workspaces = 1;
      // Orphan gate: business participant first, then CM's own assertion.
      await input.business.assertNoWorkspaceOrphans(command.workspaceId, tx);
      for (const table of ['cm_workspace_members', 'cm_identity_conversation_sessions', 'identity_invitation_digests', 'cm_workspaces'] as const) {
        const rows = await sql.query(`SELECT COUNT(*) AS c FROM ${sql.table(table)} WHERE workspace_id = ?`, [command.workspaceId]);
        if (Number(rows[0]?.['c'] ?? 0) > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
      }
      const cleanup: IdentityCleanupReceiptV1 = { deletedByTable, detachedByTable, remainingLiveReferences: 0 };
      return {
        contractVersion: '1.2.0', operationId: command.operationId, workspaceId: command.workspaceId,
        tenantId: workspace.tenantId, actorId: command.actorId, deliveryIds, business, cleanup, at,
      };
    });
  };
  return { deleteWorkspace };
};
