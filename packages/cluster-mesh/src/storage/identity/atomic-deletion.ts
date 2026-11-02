// A2.0b atomic person deletion (contract 2.0.0): all-or-rollback deletion of
// one identity plus its bound business rows. Local authority is gone before
// any external delivery; a required local failure rolls back the whole
// attempt and resolves a persisted rolled_back receipt. The frozen 1.0
// best-effort cascade is untouched; A4 explicitly selects this contract.

import { validateDeletionComposition, applyDeletionPlane, currentDeletionReceipt } from './deletion-planes.js';
import { randomUUID } from 'node:crypto';
import type {
  AtomicPersonDeletionV2,
  AtomicPersonDeletionInput,
  AtomicRevocationStepReceiptV2,
  BusinessDeletionPlanV1,
  BusinessDeletionPortV1,
  IdentityDeletionOperationV2,
  IdentityRunOptionsV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  PersonDeletionCommandV2,
  PersonDeletionReceiptV2,
} from '../../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import {
  AccountTransitionError,
  AdminUserProtectedError,
  IdentityConflictError,
  IdentityNotFoundError,
  SelfActionForbiddenError,
} from '../../identity-contracts/errors.js';
import type { AccountStatus, IdentityClock, RevocationStepKind } from '../../identity-contracts/types.js';
import { PostgresCustodyJournal } from './custody-journal-postgres.js';
import { SqliteCustodyJournal } from './custody-journal-sqlite.js';
import type { CustodyOpHost } from './custody-host.js';

const DELETE = 'delete';

const requestDigest = (command: PersonDeletionCommandV2): string =>
  (command.handlerId === 'self_account' ? PostgresCustodyJournal : SqliteCustodyJournal).requestDigestV1(
    command.userId, command.actorId, command.handlerId, command.operationId,
  );

const authorize = async (command: PersonDeletionCommandV2, account: { readonly accountStatus: AccountStatus; readonly globalRole: string }, actorStatus: AccountStatus | null): Promise<void> => {
  if (command.handlerId === 'self_account') {
    if (command.actorId !== command.userId) throw new SelfActionForbiddenError(DELETE);
  } else {
    if (command.actorId === command.userId) throw new SelfActionForbiddenError(DELETE);
    if (account.globalRole === 'admin_app' || account.globalRole === 'admin_org') throw new AdminUserProtectedError(DELETE);
    if (actorStatus !== 'active') throw new IdentityNotFoundError('user', command.actorId);
  }
  if (account.accountStatus !== 'disabled') {
    throw new AccountTransitionError('Account must be disabled before deletion');
  }
};

const validatePlan = async (
  plan: BusinessDeletionPlanV1,
  userId: string,
  journal: PostgresCustodyJournal | SqliteCustodyJournal,
): Promise<{ readonly subjectWorkspaces: readonly string[] }> => {
  if (plan.userId !== userId) throw new IdentityCustodyErrorV1('identity_material_invalid');
  const seen = new Set<string>();
  for (const workspaceId of [...plan.workspaceIdsToDelete, ...plan.retainedWorkspaceIds]) {
    if (workspaceId.length === 0 || seen.has(workspaceId)) throw new IdentityCustodyErrorV1('identity_material_invalid');
    seen.add(workspaceId);
  }
  const overlap = plan.workspaceIdsToDelete.find((id) => plan.retainedWorkspaceIds.includes(id));
  if (overlap !== undefined) throw new IdentityCustodyErrorV1('identity_material_invalid');
  const subjectWorkspaces = await journal.listWorkspaceIdsForUser(userId);
  for (const workspaceId of subjectWorkspaces) {
    if (!seen.has(workspaceId)) throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  for (const workspaceId of plan.retainedWorkspaceIds) {
    const workspace = await journal.findWorkspaceCore(workspaceId);
    if (!workspace) throw new IdentityCustodyErrorV1('identity_material_invalid');
    const role = await journal.roleInWorkspace(workspaceId, userId);
    if (role === 'admin') {
      const admins = await journal.countAdminsInWorkspace(workspaceId);
      if (admins <= 1) throw new IdentityConflictError('last_admin');
    }
  }
  for (const workspaceId of plan.workspaceIdsToDelete) {
    const workspace = await journal.findWorkspaceCore(workspaceId);
    if (!workspace) throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  return { subjectWorkspaces };
};

export const createAtomicPersonDeletionV2 = (input: AtomicPersonDeletionInput<CustodyOpHost>): AtomicPersonDeletionV2 => {
  validateDeletionComposition(input);
  const now = input.clock;
  const { reservation: reservationOptions, deletion: deletionOptions, diagnostic: diagnosticOptions, read: readOptions } = input.transactionOptions;

  const deletePerson = async (command: PersonDeletionCommandV2): Promise<PersonDeletionReceiptV2> => {
    if (command.userId.length === 0 || command.actorId.length === 0 || command.operationId.length === 0) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    if (command.handlerId !== 'self_account' && command.handlerId !== 'admin_account') {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    const at = now();
    const operation: IdentityDeletionOperationV2 = {
      operationId: command.operationId,
      userId: command.userId,
      actorId: command.actorId,
      handlerId: command.handlerId,
      requestDigest: requestDigest(command),
      state: 'queued',
      createdAt: at,
      committedAt: null,
      committedReceipt: null,
    };
    // Reservation shares a transaction with authorization: refusal persists nothing.
    // A recorded operation is digest-checked first: identical repeats resolve
    // the committed receipt, divergent repeats refuse.
    const preResolved = await input.unitOfWork.run(reservationOptions, async (tx: IdentityTransactionV1<CustodyOpHost>) => {
      const journal = tx.hostTransaction.journal;
      const recorded = await tx.deletionJournal.lock(command.operationId);
      if (recorded) {
        if (recorded.requestDigest !== operation.requestDigest || recorded.userId !== operation.userId || recorded.actorId !== operation.actorId || recorded.handlerId !== operation.handlerId) {
          throw new IdentityCustodyErrorV1('identity_operation_conflict');
        }
        if (recorded.state === 'committed') return currentDeletionReceipt(recorded.committedReceipt, tx);
        await tx.lockSubject(command.userId);
        await tx.lockSubject(command.userId);
      const account = await journal.findAccountCore(command.userId);
        if (!account) throw new IdentityNotFoundError('user', command.userId);
        const actor = command.actorId === command.userId ? account : await journal.findAccountCore(command.actorId);
        await authorize(command, account, actor?.accountStatus ?? null);
        await input.authorization.assertAllowed(command, tx);
        return null;
      }
      const account = await journal.findAccountCore(command.userId);
      if (!account) throw new IdentityNotFoundError('user', command.userId);
      const actor = command.actorId === command.userId ? account : await journal.findAccountCore(command.actorId);
      await authorize(command, account, actor?.accountStatus ?? null);
      if (command.handlerId !== input.business.handlerId) throw new IdentityCustodyErrorV1('identity_operation_conflict');
      await input.authorization.assertAllowed(command, tx);
      await journal.reserveOperation(operation);
      return null;
    });
    if (preResolved) return preResolved;

    let failedStep: RevocationStepKind = 'login_sessions';
    const completed = new Set<RevocationStepKind>();
    try {
      const receipt = await input.unitOfWork.run(deletionOptions, async (tx: IdentityTransactionV1<CustodyOpHost>) => {
        const host = tx.hostTransaction;
        const journal = host.journal;
        const stores = host.stores;
        const reserved = await tx.deletionJournal.lock(command.operationId);
        if (!reserved || reserved.requestDigest !== operation.requestDigest || reserved.actorId !== command.actorId || reserved.handlerId !== command.handlerId) throw new IdentityCustodyErrorV1('identity_operation_conflict');
        if (reserved.state === 'committed') return (await currentDeletionReceipt(reserved.committedReceipt, tx))!;
        await tx.lockSubject(command.userId);
        const account = await journal.findAccountCore(command.userId);
        if (!account) throw new IdentityNotFoundError('user', command.userId);
        const actor = command.actorId === command.userId ? account : await journal.findAccountCore(command.actorId);
        await authorize(command, account, actor?.accountStatus ?? null);
        await input.authorization.assertAllowed(command, tx);
        await tx.lockEmail(account.email);
        const plan = await input.business.prepare(command, tx);
        for (const id of [...plan.workspaceIdsToDelete, ...plan.retainedWorkspaceIds].sort()) await tx.lockWorkspace(id);
        await validatePlan(plan, command.userId, journal);

        failedStep = 'login_sessions';
        const revokedSessions = await stores.sessions.revokeAllForUser(command.userId, at);
        completed.add('login_sessions');

        failedStep = 'tenant_memberships';
        const deletedMemberships = await journal.deleteMembershipsForUser(command.userId);
        completed.add('tenant_memberships');

        failedStep = 'account';
        const businessReceipt = await input.business.deleteRows(plan, tx);
        await journal.deleteWorkspaceMembersIn(plan.workspaceIdsToDelete);
        await journal.deleteWorkspaceMembersForUser(command.userId);
        for (const workspaceId of plan.workspaceIdsToDelete) {
          await journal.detachInvitationWorkspace(workspaceId);
          await journal.deleteWorkspace(workspaceId);
        }
        await journal.deleteConsentsForUser(command.userId);
        await journal.deleteConversationsForUser(command.userId);
        await journal.deleteProofsForUser(command.userId);
        await journal.deleteDeviceCodesForUser(command.userId);
        await journal.deleteSessionsForUser(command.userId);
        const cleanup = await journal.cleanupCustodyForUser(command.userId, account.email);
        const revokedInvitations = await journal.revokePendingInvitationsForEmail(account.email);
        const detachedConsumers = await journal.detachInvitationConsumer(command.userId);
        await input.business.assertNoOrphans(plan, tx);
        await journal.assertNoLiveReferences({ userId: command.userId, accountEmail: account.email, deletedWorkspaceIds: [...plan.workspaceIdsToDelete] });
        await journal.deleteAccountCore(command.userId);
        if (await journal.findAccountCore(command.userId)) {
          throw new IdentityCustodyErrorV1('identity_orphan_detected');
        }
        await journal.retireFence(command.userId, at);
        completed.add('account');

        const receipt: PersonDeletionReceiptV2 = {
          userId: command.userId,
          mode: DELETE,
          transaction: 'committed',
          resultCode: 'identity_deleted',
          complete: true,
          steps: committedSteps(revokedSessions, deletedMemberships),
          business: businessReceipt,
          cleanup: { ...cleanup, revokedInvitationsForEmail: revokedInvitations, detachedInvitationConsumers: detachedConsumers },
          at,
        };
        await journal.markOperationCommitted(command.operationId, receipt, at);
        return receipt;
      });
      return receipt;
    } catch (error) {
      if (error instanceof IdentityNotFoundError || error instanceof SelfActionForbiddenError || error instanceof AdminUserProtectedError || error instanceof IdentityConflictError) {
        throw error;
      }
      if (error instanceof AccountTransitionError) throw error;
      const receipt = PostgresCustodyJournal.rollbackReceipt({ userId: command.userId, failedStep, completedBeforeFailure: completed, at });
      const attemptId = `${command.operationId}:${randomUUID()}`;
      try {
        await input.unitOfWork.run(diagnosticOptions, async (tx: IdentityTransactionV1<CustodyOpHost>) => {
          await tx.hostTransaction.journal.appendAttempt({ attemptId, operationId: command.operationId, at, receipt });
        });
      } catch {
        throw new IdentityCustodyErrorV1('identity_cascade_diagnostic_failed', { operationId: command.operationId });
      }
      return receipt;
    }
  };

  return {
    deletePerson,
    getOperation: (operationId) =>
      input.unitOfWork.run(readOptions, (tx) => tx.hostTransaction.journal.findOperation(operationId)),
    getReceipt: (operationId) =>
      input.unitOfWork.run(readOptions, async (tx) => currentDeletionReceipt(await tx.hostTransaction.journal.latestReceipt(operationId), tx)),
  };
};
