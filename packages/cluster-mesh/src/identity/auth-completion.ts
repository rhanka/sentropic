import type { IdentityAuthCompletionFlowV1, IdentityAuthCompletionOutcomeV1 } from '../identity-contracts/custody-auth.js';
import type { IdentityUnitOfWorkV1, IdentityTransactionV1, IdentityRunOptionsV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

import { finishAuthCompletion, IdentityAuthCompletionAbort } from './auth-abort.js';

export const runIdentityAuthCompletionV1 = async <H, T>(input: {
  readonly flow: IdentityAuthCompletionFlowV1; readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly options: IdentityRunOptionsV1; readonly operation: (tx: IdentityTransactionV1<H>) => Promise<T>;
}): Promise<IdentityAuthCompletionOutcomeV1<T>> => {
  if (input.options.mode !== 'write' || input.options.purpose !== 'request') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  try {
    const value = await input.unitOfWork.run(input.options, async (tx) => {
      const result = await input.operation(tx);
      return finishAuthCompletion(input.flow, result);
    });
    return { committed: true, value };
  } catch (error) {
    if (error instanceof IdentityAuthCompletionAbort) {
      if (error.refusal.flow !== input.flow) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      return { committed: false, refusal: error.refusal };
    }
    throw error;
  }
};
