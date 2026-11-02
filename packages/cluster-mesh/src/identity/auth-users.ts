import type { AuthHonoUserPort, AuthHonoUserRecord, AuthHonoAccountPolicyPort } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { UserAccount, GlobalRole } from '../identity-contracts/types.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

export const authRole = (role: string): GlobalRole => {
  if (!['admin_app', 'admin_org', 'editor', 'guest'].includes(role)) throw new IdentityCustodyErrorV1('identity_material_invalid');
  return role as GlobalRole;
};
const iso = (date: Date): string => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new IdentityCustodyErrorV1('identity_material_invalid');
  return date.toISOString();
};
export const authUserPorts = <H>(input: IdentityAuthBindingInput<H>, evidence: Set<string>, check: () => void): { users: AuthHonoUserPort; policy: AuthHonoAccountPolicyPort } => {
  const { tx } = input;
  const notified = new Set<string>();
  const afterUserCreated = async (user: AuthHonoUserRecord): Promise<void> => {
    check();
    if (!notified.has(user.id)) { await input.business.afterUserCreated(user, tx); notified.add(user.id); }
  };
  const normalizeEmail = (email: string): string => {
    const canonical = email.trim().toLowerCase();
    if (!canonical.includes('@') || input.accountPolicy.normalizeEmail(email) !== canonical) throw new IdentityCustodyErrorV1('identity_material_invalid');
    return canonical;
  };
  const project = async (account: UserAccount | null): Promise<AuthHonoUserRecord | null> => {
    if (!account || account.accountStatus === 'deleted') return null;
    const profile = await tx.custody.profiles.find(account.userId);
    if (!profile) throw new IdentityCustodyErrorV1('identity_material_missing');
    let status: string = account.accountStatus;
    if (status === 'disabled') {
      if (!profile.legacyAccountStatus) throw new IdentityCustodyErrorV1('identity_material_missing');
      if (!['disabled_by_user', 'disabled_by_admin'].includes(profile.legacyAccountStatus)) throw new IdentityCustodyErrorV1('identity_material_invalid');
      status = profile.legacyAccountStatus;
    } else if (status === 'pending_admin_approval' && profile.legacyAccountStatus === 'approval_expired_readonly') status = profile.legacyAccountStatus;
    return { id: account.userId, email: account.email, displayName: profile.displayName, role: authRole(account.globalRole),
      emailVerified: profile.emailVerified, accountStatus: status, approvalDueAt: profile.approvalDueAt === null ? null : new Date(profile.approvalDueAt),
      createdAt: new Date(account.createdAt), updatedAt: new Date(account.updatedAt) };
  };
  const users: AuthHonoUserPort = {
    findById: async (id) => { check(); return project(await tx.stores.accounts.findAccount(id)); },
    findByEmail: async (email) => { check(); return project(await tx.stores.accounts.findAccountByEmail(normalizeEmail(email))); },
    count: async () => { check(); return (await tx.stores.accounts.listAccounts()).filter((a) => a.accountStatus !== 'deleted').length; },
    create: async (value) => {
      check();
      if (Object.keys(value).some((key) => !['email', 'displayName', 'role', 'emailVerified', 'accountStatus', 'approvalDueAt'].includes(key))) throw new IdentityCustodyErrorV1('identity_material_invalid');
      const email = normalizeEmail(value.email), at = iso(input.hostPorts.clock.now()), userId = input.hostPorts.random.uuid();
      authRole(value.role);
      if (value.emailVerified === true && !evidence.has(email)) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      const isFirstUser = (await users.count()) === 0;
      const role = authRole(await input.accountPolicy.roleForNewUser({ email, isFirstUser }));
      const statusPolicy = await input.accountPolicy.statusForNewUser({ email, isFirstUser, now: new Date(at) });
      const status = statusPolicy.accountStatus;
      if (status !== 'active' && status !== 'pending_admin_approval') throw new IdentityCustodyErrorV1('identity_material_invalid');
      await tx.custody.subjects.register({ userId, email, accountStatus: status as 'active' | 'pending_admin_approval', globalRole: role, createdAt: at, updatedAt: at }, {
        userId, emailVerified: value.emailVerified ?? false, displayName: value.displayName ?? null, approvalDueAt: statusPolicy.approvalDueAt === null ? null : iso(statusPolicy.approvalDueAt),
        approvedAt: null, approvedByUserId: null, disabledAt: null, disabledReason: null, legacyAccountStatus: null,
      });
      const created = (await users.findById(userId))!;
      await afterUserCreated(created);
      return created;
    },
    update: async (id, value) => {
      check(); await tx.lockSubject(id);
      const user = await users.findById(id);
      if (!user) return null;
      if (Object.keys(value).some((key) => !['email', 'displayName', 'role', 'emailVerified', 'accountStatus', 'approvalDueAt', 'updatedAt'].includes(key))) throw new IdentityCustodyErrorV1('identity_material_invalid');
      if (value.email === null) throw new IdentityCustodyErrorV1('identity_material_invalid');
      if ((value.role !== undefined && value.role !== user.role) || (value.accountStatus !== undefined && value.accountStatus !== user.accountStatus)
        || (value.approvalDueAt !== undefined && (value.approvalDueAt === null ? null : iso(value.approvalDueAt)) !== (user.approvalDueAt?.toISOString() ?? null))) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
      const email = value.email === undefined ? user.email! : normalizeEmail(value.email);
      if (value.emailVerified === true && !evidence.has(email)) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      const profile = (await tx.custody.profiles.find(id))!;
      await tx.custody.subjects.updateEmail(id, email, iso(value.updatedAt === undefined ? input.hostPorts.clock.now() : value.updatedAt));
      await tx.custody.profiles.put({ ...profile, displayName: value.displayName === undefined ? profile.displayName : value.displayName,
        emailVerified: value.emailVerified ?? (email === user.email ? profile.emailVerified : false) });
      return users.findById(id);
    },
  };
  const allowed = (user: AuthHonoUserRecord): boolean => user.emailVerified && ['active', 'pending_admin_approval', 'approval_expired_readonly'].includes(user.accountStatus);
  return { users, policy: {
    ...input.accountPolicy, normalizeEmail,
    canAuthenticate: (user) => ({ allowed: allowed(user) }),
    resolveSessionRole: (user, now) => user.accountStatus === 'approval_expired_readonly'
      || (user.accountStatus === 'pending_admin_approval' && user.approvalDueAt !== null && now > user.approvalDueAt) ? 'guest' : user.role,
    afterUserCreated,
  } };
};
