import { createWorkspaceDirectory, IdentityConflictError, IdentityCustodyErrorV1, IdentityNotFoundError,
  type WorkspaceRole } from '@sentropic/cluster-mesh';
import { CmIdentityForbiddenError } from './cm-deletion-authorization';
import { runCmIdentityRead, runCmIdentityWrite, type CmIdentityTransaction } from './cm-transaction';

export class CmWorkspaceMembershipPolicyError extends Error {
  constructor(message: string, readonly responseKey: 'message' | 'error' = 'message') { super(message); }
}
const directory = (tx: CmIdentityTransaction) => createWorkspaceDirectory({
  workspaces: tx.stores.workspaces, members: tx.stores.workspaceMembers, audit: tx.stores.audit,
});
const requireMember = async (actorId: string, workspaceId: string, admin: boolean, tx: CmIdentityTransaction) => {
  const account = await tx.stores.accounts.findAccount(actorId);
  const member = await tx.stores.workspaceMembers.findWorkspaceMember(workspaceId, actorId);
  if (!account || account.accountStatus !== 'active' || !member || (admin && member.role !== 'admin')) {
    throw new CmIdentityForbiddenError();
  }
  if (!await tx.custody.profiles.find(actorId)) throw new IdentityCustodyErrorV1('identity_material_missing');
  if (!await tx.stores.workspaces.findWorkspace(workspaceId)) throw new IdentityNotFoundError('workspace', workspaceId);
};

export const listCmWorkspaceMemberViews = (actorId: string, workspaceId: string) => runCmIdentityRead(async tx => {
  await requireMember(actorId, workspaceId, false, tx);
  const members = await directory(tx).listWorkspaceMembers(workspaceId);
  const rows = [];
  for (const member of members) {
    const account = await tx.stores.accounts.findAccount(member.userId);
    const profile = await tx.custody.profiles.find(member.userId);
    if (!account || !profile) throw new IdentityCustodyErrorV1('identity_material_missing');
    rows.push({ userId: member.userId, email: account.email, displayName: profile.displayName,
      role: member.role, createdAt: null });
  }
  return rows.sort((a, b) => a.userId.localeCompare(b.userId));
});

type MemberAction = { kind: 'add'; email: string; role: WorkspaceRole }
  | { kind: 'set_role'; userId: string; role: WorkspaceRole }
  | { kind: 'remove'; userId: string };
export const changeCmWorkspaceMember = (command: { actorId: string; workspaceId: string; action: MemberAction }) =>
  runCmIdentityWrite(async tx => {
    const { actorId, workspaceId, action } = command;
    // Authorize before revealing whether the requested target exists.
    await requireMember(actorId, workspaceId, true, tx);
    const target = action.kind === 'add'
      ? await tx.stores.accounts.findAccountByEmail(action.email.trim().toLowerCase())
      : await tx.stores.accounts.findAccount(action.userId);
    if (!target && action.kind !== 'remove') throw new IdentityNotFoundError('user');
    const targetUserId = target?.userId ?? (action.kind === 'remove' ? action.userId : '');
    for (const id of [...new Set(target ? [actorId, target.userId] : [actorId])].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      await tx.lockSubject(id);
    }
    await tx.lockWorkspace(workspaceId);
    await requireMember(actorId, workspaceId, true, tx);
    const { rows } = await tx.hostTransaction.query<{ type: string }>(
      'SELECT type FROM public.workspaces WHERE id = $1', [workspaceId]);
    if (!rows[0]) throw new IdentityNotFoundError('workspace', workspaceId);
    if (actorId === targetUserId && action.kind !== 'add') {
      throw new CmWorkspaceMembershipPolicyError(action.kind === 'remove' ? 'Cannot remove yourself' : 'Cannot change your own role');
    }
    if (rows[0].type === 'neutral') throw new CmWorkspaceMembershipPolicyError('Neutral workspaces do not support memberships', 'error');
    const domain = directory(tx);
    const members = await domain.listWorkspaceMembers(workspaceId);
    const existing = members.find(member => member.userId === targetUserId);
    if (action.kind === 'remove' && !existing) return { userId: targetUserId, changed: false };
    if (!target) throw new IdentityCustodyErrorV1('identity_material_missing');
    if (existing?.role === 'admin' && (action.kind === 'remove' || action.role !== 'admin')
      && members.filter(member => member.role === 'admin').length === 1) throw new IdentityConflictError('last_admin');
    const input = { workspaceId, userId: target.userId, actorId };
    if (action.kind === 'remove') await domain.removeWorkspaceMember(input);
    else if (action.kind === 'set_role') await domain.setWorkspaceRole({ ...input, role: action.role });
    else await domain.addWorkspaceMember({ ...input, role: action.role });
    await tx.advanceSubjectRevision(target.userId, new Date().toISOString(), false);
    return { userId: target.userId, changed: true };
  });
