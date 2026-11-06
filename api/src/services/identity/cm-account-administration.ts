import { createUserAccounts, IdentityCustodyErrorV1, IdentityNotFoundError,
  type GlobalRole } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from './cm-auth-runtime';
import { CmIdentityForbiddenError } from './cm-deletion-authorization';

type AdminAction = { readonly kind: 'approve'; readonly role?: GlobalRole }
  | { readonly kind: 'disable'; readonly reason?: string } | { readonly kind: 'reactivate' };

export const changeCmAccountAsAdmin = (input: {
  readonly actorId: string; readonly userId: string; readonly action: AdminAction;
}): Promise<void> => withAppCmAuth(runner => runner.request(async (binding, tx) => {
  const ids = [...new Set([input.actorId, input.userId])].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const id of ids) await tx.lockSubject(id);
  const actor = await tx.stores.accounts.findAccount(input.actorId);
  if (!actor || actor.accountStatus !== 'active' || actor.globalRole !== 'admin_app') throw new CmIdentityForbiddenError();
  if (!await tx.custody.profiles.find(input.actorId)) throw new IdentityCustodyErrorV1('identity_material_missing');
  const target = await tx.stores.accounts.findAccount(input.userId);
  if (!target) throw new IdentityNotFoundError('user', input.userId);
  const profile = await tx.custody.profiles.find(input.userId);
  if (!profile) throw new IdentityCustodyErrorV1('identity_material_missing');
  const at = new Date().toISOString();
  const accounts = createUserAccounts({ accounts: tx.stores.accounts, audit: tx.stores.audit, clock: () => at });
  const action = input.action;
  if (action.kind === 'disable') {
    await accounts.disableAccount(input.userId, input.actorId);
    await tx.custody.profiles.put({ ...profile, disabledAt: at, disabledReason: action.reason ?? 'disabled_by_admin',
      legacyAccountStatus: 'disabled_by_admin' });
    await binding.sessions.revokeAllSessions(input.userId);
  } else {
    if (action.kind === 'approve') await accounts.approveAccount(input.userId, {
      actorId: input.actorId, role: action.role ?? target.globalRole,
    });
    else await accounts.reactivateAccount(input.userId, input.actorId);
    await tx.custody.profiles.put({ ...profile, approvalDueAt: null, approvedAt: at,
      approvedByUserId: input.actorId, disabledAt: null, disabledReason: null, legacyAccountStatus: null });
  }
  await tx.advanceSubjectRevision(input.userId, at, false);
}));

export const deactivateOwnCmAccount = (userId: string): Promise<void> =>
  withAppCmAuth(runner => runner.request(async (binding, tx) => {
    await tx.lockSubject(userId);
    const profile = await tx.custody.profiles.find(userId);
    if (!profile) throw new IdentityCustodyErrorV1('identity_material_missing');
    const at = new Date().toISOString();
    await createUserAccounts({ accounts: tx.stores.accounts, audit: tx.stores.audit, clock: () => at }).disableSelf(userId);
    await tx.custody.profiles.put({ ...profile, disabledAt: at, disabledReason: 'user_deactivated', legacyAccountStatus: 'disabled_by_user' });
    await binding.sessions.revokeAllSessions(userId);
    await tx.advanceSubjectRevision(userId, at, false);
  }));
