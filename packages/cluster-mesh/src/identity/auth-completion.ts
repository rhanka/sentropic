import type { IdentityAuthCompletionFlowV1, IdentityAuthCompletionOutcomeV1, IdentityAuthRefusalV1 } from '../identity-contracts/custody-auth.js';
import type { IdentityUnitOfWorkV1, IdentityTransactionV1, IdentityRunOptionsV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

class CompletionRefusal extends Error {
  constructor(readonly refusal: IdentityAuthRefusalV1) { super('Authentication refused'); }
}

export const runIdentityAuthCompletionV1 = async <H, T>(input: {
  readonly flow: IdentityAuthCompletionFlowV1; readonly unitOfWork: IdentityUnitOfWorkV1<H>;
  readonly options: IdentityRunOptionsV1; readonly operation: (tx: IdentityTransactionV1<H>) => Promise<T>;
}): Promise<IdentityAuthCompletionOutcomeV1<T>> => {
  if (input.options.mode !== 'write' || input.options.purpose !== 'request') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  try {
    const value = await input.unitOfWork.run(input.options, async (tx) => {
      const result = await input.operation(tx);
      const record = result as { verified?: boolean; valid?: boolean; success?: boolean } | null;
      const refused = ['registration', 'authentication'].includes(input.flow) ? record?.verified === false
        : ['magic_link', 'email_code'].includes(input.flow) ? record?.valid === false
          : ['magic_link_issue', 'email_code_issue'].includes(input.flow) ? record?.success === false
            : ['session_validate', 'session_refresh', 'credential_rename'].includes(input.flow) ? result === null
              : ['credential_revoke', 'social_unlink'].includes(input.flow) ? result === false : false;
      if (refused) throw new CompletionRefusal({ flow: input.flow, result } as IdentityAuthRefusalV1);
      return result;
    });
    return { committed: true, value };
  } catch (error) {
    if (error instanceof CompletionRefusal) return { committed: false, refusal: error.refusal };
    throw error;
  }
};
