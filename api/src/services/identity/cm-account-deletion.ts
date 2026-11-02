import { randomUUID } from 'node:crypto';
import { createAtomicPersonDeletionV2, type BusinessDeletionHandlerIdV1 } from '@sentropic/cluster-mesh';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { createAppCmBusinessDeletion } from './cm-deletion-business';
import { cmAccountDeletionAuthorization } from './cm-deletion-authorization';
import { loadCmDeletionOptions } from './cm-deletion-options';
import { createAppCmDeletionPlanes } from './cm-deletion-planes';

const coordinator = (handlerId: BusinessDeletionHandlerIdV1) => createAtomicPersonDeletionV2({
  unitOfWork: cmIdentityUnitOfWork, business: createAppCmBusinessDeletion(handlerId),
  authorization: cmAccountDeletionAuthorization(handlerId), planes: createAppCmDeletionPlanes(),
  clock: () => new Date().toISOString(), transactionOptions: loadCmDeletionOptions(),
});

/** Caller ids come from verified HTTP authority; the request cannot select a handler. */
export const deleteOwnCmAccount = (userId: string, operationId = randomUUID()) => {
  return coordinator('self_account').deletePerson({ operationId, userId, actorId: userId });
};
export const deleteCmAccountAsAdmin = (input: { readonly userId: string; readonly actorId: string }, operationId = randomUUID()) => {
  return coordinator('admin_account').deletePerson({ operationId, ...input });
};
