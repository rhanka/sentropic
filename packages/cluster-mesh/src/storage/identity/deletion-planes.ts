import type { AtomicPersonDeletionInput, IdentityTransactionV1, PersonDeletionReceiptV2, PersonDeletionCommandV2, BusinessDeletionPlanV1, IdentityExternalRevocationV1, AtomicRevocationStepReceiptV2 } from '../../identity-contracts/custody.js';
import type { PersonDeletionPlanePortV2 } from '../../identity-contracts/custody-operations.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import { requireIdentityRunOptions } from './custody-transaction-guards.js';
import { identityDeliveryId } from './custody-import-deliveries.js';

export const deletionPlaneSteps = ['remote_reader_sessions', 'connector_grants', 'agent_plane', 'purpose_grants', 'catalogue'] as const;

export const validateDeletionComposition = <H>(input: AtomicPersonDeletionInput<H>): void => {
  if (!input.business?.prepare || !input.business.deleteRows || !input.business.assertNoOrphans || !input.authorization?.assertAllowed) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  if (!input.planes || input.planes.length !== deletionPlaneSteps.length
    || deletionPlaneSteps.some((step) => input.planes.filter((plane) => plane.step === step).length !== 1)
    || input.planes.some((plane) => !plane.apply || !plane.assertAbsent || !plane.assertDeliveryInScope || !['present', 'absent'].includes(plane.placement))) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  for (const kind of ['reservation', 'deletion', 'diagnostic', 'read'] as const) {
    const options = input.transactionOptions?.[kind];
    if (!options) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
    requireIdentityRunOptions(options);
    if (options.purpose !== 'delete' || options.mode !== (kind === 'read' ? 'read' : 'write')) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
};

export const applyDeletionPlane = async <H>(plane: PersonDeletionPlanePortV2<H>, command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1, tx: IdentityTransactionV1<H>, at: string): Promise<{ step: AtomicRevocationStepReceiptV2; deliveryIds: string[] }> => {
  if (plane.placement === 'absent') return { step: { step: plane.step, outcome: 'not_applicable', detailCode: 'plane_absent' }, deliveryIds: [] };
  const drafts = await plane.apply(command, plan, tx);
  const ids = new Set<string>();
  for (const draft of drafts) {
    const connector = plane.step === 'connector_grants';
    if (draft.step !== plane.step || !draft.subjectId || !draft.targetRef
      || !['login_session', 'subject', 'connector_grant', 'plane_resource'].includes(draft.targetKind)
      || (connector && (draft.targetKind !== 'connector_grant' || !draft.custodyRef))
      || (!connector && (draft.subjectId !== command.userId || draft.targetKind === 'connector_grant'))) {
      throw new IdentityCustodyErrorV1(connector ? 'identity_revocation_custody_invalid' : 'proof_binding_mismatch');
    }
    await plane.assertDeliveryInScope(command, plan, draft, tx);
    const deliveryId = identityDeliveryId(command.operationId, draft.step, draft.targetKind, draft.targetRef);
    const record: IdentityExternalRevocationV1 = { ...draft, deliveryId, operationId: command.operationId, state: 'pending', createdAt: at, nextAttemptAt: at, deliveredAt: null, claimOwner: null, claimVersion: 0, leaseUntil: null, attemptCount: 0 };
    await tx.revocationOutbox.enqueue(record);
    ids.add(deliveryId);
  }
  return { step: { step: plane.step, outcome: ids.size ? 'queued' : 'applied', detailCode: ids.size ? 'external_delivery_pending' : 'local_effects_committed' }, deliveryIds: [...ids] };
};

export const currentDeletionReceipt = async <H>(receipt: PersonDeletionReceiptV2 | null, tx: IdentityTransactionV1<H>): Promise<PersonDeletionReceiptV2 | null> => {
  if (!receipt || receipt.transaction !== 'committed') return receipt;
  const deliveries = await Promise.all(receipt.deliveryIds.map((id) => tx.revocationOutbox.find(id)));
  if (deliveries.some((record) => !record)) throw new IdentityCustodyErrorV1('identity_material_missing');
  const pending = deliveries.filter((record) => record!.state === 'pending');
  return { ...receipt, complete: pending.length === 0,
    steps: receipt.steps.map((step) => step.outcome === 'queued' && !pending.some((record) => record!.step === step.step)
      ? { ...step, outcome: 'applied', detailCode: 'external_delivery_complete' } : step),
  };
};
