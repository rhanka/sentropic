import { randomUUID } from 'node:crypto';
import { createAtomicPersonDeletionV2, type BusinessDeletionHandlerIdV1 } from '@sentropic/cluster-mesh';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { createAppCmBusinessDeletion } from './cm-deletion-business';
import { cmAccountDeletionAuthorization } from './cm-deletion-authorization';
import { loadCmDeletionOptions } from './cm-deletion-options';
import { createAppCmDeletionPlanes } from './cm-deletion-planes';
import type { CmSelfDeletionContinuation } from './cm-self-deletion-proof';

const coordinator = (handlerId: BusinessDeletionHandlerIdV1, continuation?: CmSelfDeletionContinuation) => createAtomicPersonDeletionV2({
  unitOfWork: cmIdentityUnitOfWork, business: createAppCmBusinessDeletion(handlerId),
  authorization: cmAccountDeletionAuthorization(handlerId, continuation), planes: createAppCmDeletionPlanes(),
  clock: () => new Date().toISOString(), transactionOptions: loadCmDeletionOptions(),
});

export const readCmAccountDeletionReceipt = (operationId: string) => coordinator('self_account').getReceipt(operationId);

/** Caller ids come from verified HTTP authority; the request cannot select a handler. */
export const deleteOwnCmAccount = (userId: string, operationId: string = randomUUID(), continuation?: CmSelfDeletionContinuation) => {
  return coordinator('self_account', continuation).deletePerson({ operationId, userId, actorId: userId, handlerId: 'self_account' });
};
export const deleteCmAccountAsAdmin = (input: { readonly userId: string; readonly actorId: string }, operationId: string = randomUUID()) => {
  return coordinator('admin_account').deletePerson({ operationId, ...input, handlerId: 'admin_account' });
};
