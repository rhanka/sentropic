import { AccountTransitionError, AdminUserProtectedError, IdentityCustodyErrorV1, IdentityNotFoundError,
  SelfActionForbiddenError, type BusinessDeletionHandlerIdV1,
  type PersonDeletionAuthorizationPortV1 } from '@sentropic/cluster-mesh';
import type { AppCustodyHost } from './cm-transaction';

export class CmIdentityForbiddenError extends Error {
  readonly code = 'identity_forbidden';
  constructor() { super('Identity action is forbidden.'); }
}

/** A fixed route selects this authorizer; no command can choose another handler. */
export const cmAccountDeletionAuthorization = (handlerId: BusinessDeletionHandlerIdV1): PersonDeletionAuthorizationPortV1<AppCustodyHost> => ({
  async assertAllowed(command, tx) {
    const target = await tx.stores.accounts.findAccount(command.userId);
    if (!target) throw new IdentityNotFoundError('user', command.userId);
    const profile = await tx.custody.profiles.find(command.userId);
    if (!profile) throw new IdentityCustodyErrorV1('identity_material_missing');
    if (handlerId === 'self_account') {
      if (command.actorId !== command.userId) throw new SelfActionForbiddenError('delete');
      if (target.accountStatus === 'disabled' && (profile.legacyAccountStatus !== 'disabled_by_user'
        || profile.disabledReason !== 'user_deactivated')) throw new CmIdentityForbiddenError();
    } else {
      if (command.actorId === command.userId) throw new SelfActionForbiddenError('delete');
      const actor = await tx.stores.accounts.findAccount(command.actorId);
      if (!actor || actor.accountStatus !== 'active' || actor.globalRole !== 'admin_app') throw new CmIdentityForbiddenError();
      if (!await tx.custody.profiles.find(command.actorId)) throw new IdentityCustodyErrorV1('identity_material_missing');
      if (target.globalRole === 'admin_app' || target.globalRole === 'admin_org') throw new AdminUserProtectedError('delete');
    }
    if (target.accountStatus !== 'disabled'
      && !(handlerId !== 'self_account' && target.accountStatus === 'pending_admin_approval')) {
      throw new AccountTransitionError('User must be disabled before deletion');
    }
  },
});
