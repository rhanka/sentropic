import { AccountTransitionError, AdminUserProtectedError, IdentityNotFoundError,
  SelfActionForbiddenError, type BusinessDeletionHandlerIdV1,
  type PersonDeletionAuthorizationPortV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';

export class CmIdentityForbiddenError extends Error {
  readonly code = 'identity_forbidden';
  constructor() { super('Identity action is forbidden.'); }
}

/** A fixed route selects this authorizer; no command can choose another handler. */
export const cmAccountDeletionAuthorization = (handlerId: BusinessDeletionHandlerIdV1): PersonDeletionAuthorizationPortV1<PoolClient> => ({
  async assertAllowed(command, tx) {
    const target = await tx.stores.accounts.findAccount(command.userId);
    if (!target) throw new IdentityNotFoundError('user', command.userId);
    if (handlerId === 'self_account') {
      if (command.actorId !== command.userId) throw new SelfActionForbiddenError('delete');
    } else {
      if (command.actorId === command.userId) throw new SelfActionForbiddenError('delete');
      const actor = await tx.stores.accounts.findAccount(command.actorId);
      if (!actor || actor.accountStatus !== 'active' || actor.globalRole !== 'admin_app') throw new CmIdentityForbiddenError();
      if (target.globalRole === 'admin_app' || target.globalRole === 'admin_org') throw new AdminUserProtectedError('delete');
    }
    if (target.accountStatus !== 'disabled') throw new AccountTransitionError('User must be disabled before deletion');
  },
});
