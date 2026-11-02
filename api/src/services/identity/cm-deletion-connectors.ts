import { IdentityCustodyErrorV1, type BusinessDeletionPlanV1, type IdentityExternalRevocationDraftV1,
  type PersonDeletionCommandV2, type PersonDeletionPlanePortV2 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { createAppConnectorCustody, type ConnectorSourceScope } from './cm-connector-custody';
import { identityDeliveryId } from './cm-delivery-record';
import type { CmIdentityTransaction } from './cm-transaction';

interface Attempt {
  readonly command: PersonDeletionCommandV2;
  readonly plan: BusinessDeletionPlanV1;
  readonly sources: Map<string, ConnectorSourceScope>;
  readonly drafts: Map<string, IdentityExternalRevocationDraftV1>;
}
const invalid = (): never => { throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid'); };
const matches = (attempt: Attempt | undefined, command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1) =>
  attempt && attempt.command.operationId === command.operationId && attempt.command.userId === command.userId
    && attempt.command.actorId === command.actorId && plan.userId === attempt.plan.userId
    && JSON.stringify([...plan.workspaceIdsToDelete].sort()) === JSON.stringify([...attempt.plan.workspaceIdsToDelete].sort())
    && JSON.stringify([...plan.retainedWorkspaceIds].sort()) === JSON.stringify([...attempt.plan.retainedWorkspaceIds].sort());

/** Capability capture and the coordinator's enqueue share the root's guarded transaction. */
export function createCmDeletionConnectorPlane(): PersonDeletionPlanePortV2<PoolClient> {
  const attempts = new WeakMap<CmIdentityTransaction, Attempt>();
  const custody = createAppConnectorCustody(async (source, input, tx) => {
    const attempt = attempts.get(tx), expected = attempt?.sources.get(source.id);
    if (!attempt || !expected || source.userId !== expected.userId || source.provider !== expected.provider
      || source.workspaceId !== expected.workspaceId || input.subjectId !== expected.userId
      || input.deliveryId !== identityDeliveryId(attempt.command.operationId, 'connector_grants', 'connector_grant', source.id)
      || input.workspaceIdsToDelete.length !== attempt.plan.workspaceIdsToDelete.length
      || input.workspaceIdsToDelete.some(id => !attempt.plan.workspaceIdsToDelete.includes(id))
      || !(source.userId === attempt.command.userId || attempt.plan.workspaceIdsToDelete.includes(source.workspaceId))) invalid();
  });
  return {
    step: 'connector_grants', placement: 'present',
    async apply(command, plan, tx) {
      const attempt: Attempt = { command, plan, sources: new Map(), drafts: new Map() };
      attempts.set(tx, attempt);
      const result = await tx.hostTransaction.query<{
        id: string; user_id: string; workspace_id: string; provider: string;
      }>(`SELECT id, user_id, workspace_id, provider FROM public.document_connector_accounts
        WHERE user_id = $1 OR workspace_id = ANY($2::text[]) ORDER BY id COLLATE "C" FOR UPDATE`,
      [command.userId, plan.workspaceIdsToDelete]);
      for (const row of result.rows) attempt.sources.set(row.id, {
        id: row.id, userId: row.user_id, workspaceId: row.workspace_id, provider: row.provider,
      });
      const at = new Date().toISOString();
      for (const source of attempt.sources.values()) {
        const deliveryId = identityDeliveryId(command.operationId, 'connector_grants', 'connector_grant', source.id);
        const captured = await custody.capture({ deliveryId, connectorAccountId: source.id, subjectId: source.userId,
          workspaceIdsToDelete: plan.workspaceIdsToDelete, at }, tx);
        if (captured.kind === 'no_capability') continue;
        attempt.drafts.set(source.id, { step: 'connector_grants', subjectId: source.userId,
          targetKind: 'connector_grant', targetRef: source.id, custodyRef: captured.reference.custodyRef });
      }
      return [...attempt.drafts.values()];
    },
    async assertDeliveryInScope(command, plan, draft, tx) {
      const attempt = attempts.get(tx), expected = attempt?.drafts.get(draft.targetRef);
      if (!matches(attempt, command, plan)) {
        throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      }
      if (!expected || draft.step !== expected.step || draft.targetKind !== expected.targetKind
        || draft.subjectId !== expected.subjectId || draft.custodyRef !== expected.custodyRef) invalid();
    },
    async assertAbsent(command, plan, tx) {
      const attempt = attempts.get(tx);
      if (!attempt || !matches(attempt, command, plan)) {
        throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      }
      const remaining = await tx.hostTransaction.query(`SELECT 1 FROM public.document_connector_accounts
        WHERE user_id = $1 OR workspace_id = ANY($2::text[]) LIMIT 1`, [command.userId, plan.workspaceIdsToDelete]);
      if (remaining.rows.length) invalid();
      for (const draft of attempt.drafts.values()) {
        const delivery = await tx.revocationOutbox.find(identityDeliveryId(command.operationId,
          draft.step, draft.targetKind, draft.targetRef));
        if (!delivery) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
        await custody.assertCaptured(delivery, tx);
      }
    },
  };
}
