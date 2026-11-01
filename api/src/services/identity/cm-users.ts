// Lot A4: app-facing user facade over the CM identity stores. Replaces every
// read/write of the legacy `public.users` table: the account row lives in
// `cm_identity.identity_user_accounts`, the profile fields (emailVerified,
// displayName, approval, disable) in `cm_identity.identity_account_profiles`.
// Ids are preserved by the 0014 migration; no legacy fallback.

import { randomUUID } from 'node:crypto';

import type { AccountStatus, GlobalRole } from '@sentropic/cluster-mesh';

import { getCmIdentity } from './cm-identity';

export interface CmUserRecord {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly role: string;
  readonly emailVerified: boolean;
  readonly accountStatus: string;
  readonly approvalDueAt: Date | null;
  readonly approvedAt: Date | null;
  readonly approvedByUserId: string | null;
  readonly disabledAt: Date | null;
  readonly disabledReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CmCreateUserInput {
  readonly email: string;
  readonly displayName?: string | null;
  readonly role: string;
  readonly emailVerified?: boolean;
  readonly accountStatus?: string;
  readonly approvalDueAt?: Date | null;
  /** Caller-chosen id (registration binds the challenge to a temp id). */
  readonly userId?: string;
}

export interface CmUpdateUserInput {
  readonly email?: string | null;
  readonly displayName?: string | null;
  readonly role?: string;
  readonly emailVerified?: boolean;
  readonly accountStatus?: string;
  readonly approvalDueAt?: Date | null;
  readonly approvedAt?: Date | null;
  readonly approvedByUserId?: string | null;
  readonly disabledAt?: Date | null;
  readonly disabledReason?: string | null;
  readonly updatedAt?: Date;
}

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

const date = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

/** CM `AccountStatus` is coarser than the app status; the precise app status is
 *  kept in the profile's `legacy_account_status` and mapped back on read. */
const toCmStatus = (appStatus: string | undefined): AccountStatus => {
  switch (appStatus) {
    case 'active':
    case 'approval_expired_readonly':
      return 'active';
    case 'pending_admin_approval':
      return 'pending_admin_approval';
    case 'disabled_by_user':
    case 'disabled_by_admin':
    case 'disabled':
      return 'disabled';
    case 'deleted':
      return 'deleted';
    default:
      return 'active';
  }
};

const fromCmStatus = (status: AccountStatus, legacy: string | null): string => {
  if (legacy) return legacy;
  switch (status) {
    case 'active':
      return 'active';
    case 'pending_admin_approval':
      return 'pending_admin_approval';
    case 'disabled':
      return 'disabled_by_admin';
    case 'deleted':
      return 'deleted';
  }
};

const toRecord = (
  account: { userId: string; email: string; accountStatus: AccountStatus; globalRole: GlobalRole; createdAt: string; updatedAt: string },
  profile: { emailVerified: boolean; displayName: string | null; approvalDueAt: string | null; approvedAt: string | null; approvedByUserId: string | null; disabledAt: string | null; disabledReason: string | null; legacyAccountStatus: string | null } | null,
): CmUserRecord => ({
  id: account.userId,
  email: account.email,
  displayName: profile?.displayName ?? null,
  role: account.globalRole,
  emailVerified: profile?.emailVerified ?? false,
  accountStatus: fromCmStatus(account.accountStatus, profile?.legacyAccountStatus ?? null),
  approvalDueAt: date(profile?.approvalDueAt),
  approvedAt: date(profile?.approvedAt),
  approvedByUserId: profile?.approvedByUserId ?? null,
  disabledAt: date(profile?.disabledAt),
  disabledReason: profile?.disabledReason ?? null,
  createdAt: new Date(account.createdAt),
  updatedAt: new Date(account.updatedAt),
});

export const findCmUserById = async (userId: string): Promise<CmUserRecord | null> => {
  const { core, custody } = getCmIdentity();
  const account = await core.accounts.findAccount(userId);
  if (!account) return null;
  const profile = await custody.profiles.find(userId);
  return toRecord(account, profile);
};

export const findCmUserByEmail = async (email: string): Promise<CmUserRecord | null> => {
  const { core, custody } = getCmIdentity();
  const account = await core.accounts.findAccountByEmail(email.trim().toLowerCase());
  if (!account) return null;
  const profile = await custody.profiles.find(account.userId);
  return toRecord(account, profile);
};

export const listCmUsers = async (): Promise<CmUserRecord[]> => {
  const { core, custody } = getCmIdentity();
  const accounts = await core.accounts.listAccounts();
  const records: CmUserRecord[] = [];
  for (const account of accounts) {
    const profile = await custody.profiles.find(account.userId);
    records.push(toRecord(account, profile));
  }
  return records;
};

export const countCmUsers = async (): Promise<number> => {
  const { core } = getCmIdentity();
  return (await core.accounts.listAccounts()).length;
};

export const countCmUsersWithRole = async (role: string): Promise<number> => {
  const { core } = getCmIdentity();
  const accounts = await core.accounts.listAccounts();
  return accounts.filter((account) => account.globalRole === role).length;
};

export const createCmUser = async (input: CmCreateUserInput): Promise<CmUserRecord> => {
  const { core, custody } = getCmIdentity();
  const now = new Date().toISOString();
  const userId = input.userId ?? randomUUID();
  const appStatus = input.accountStatus ?? 'active';
  await core.accounts.createAccount({
    userId,
    email: input.email.trim().toLowerCase(),
    accountStatus: toCmStatus(appStatus),
    globalRole: (input.role as GlobalRole) ?? 'guest',
    createdAt: now,
    updatedAt: now,
  });
  await custody.profiles.put({
    userId,
    emailVerified: input.emailVerified ?? false,
    displayName: input.displayName ?? null,
    approvalDueAt: iso(input.approvalDueAt ?? null),
    approvedAt: null,
    approvedByUserId: null,
    disabledAt: null,
    disabledReason: null,
    legacyAccountStatus: appStatus,
  });
  const created = await findCmUserById(userId);
  if (!created) throw new Error('Failed to create user.');
  return created;
};

export const updateCmUser = async (userId: string, input: CmUpdateUserInput): Promise<CmUserRecord | null> => {
  const { core, custody } = getCmIdentity();
  const at = (input.updatedAt ?? new Date()).toISOString();
  const account = await core.accounts.findAccount(userId);
  if (!account) return null;
  if (input.accountStatus !== undefined && input.accountStatus !== fromCmStatus(account.accountStatus, null)) {
    await core.accounts.setAccountStatus(userId, toCmStatus(input.accountStatus), at);
  }
  if (input.role !== undefined && input.role !== account.globalRole) {
    await core.accounts.setGlobalRole(userId, input.role as GlobalRole, at);
  }
  const profile = await custody.profiles.find(userId);
  await custody.profiles.put({
    userId,
    emailVerified: input.emailVerified ?? profile?.emailVerified ?? false,
    displayName: input.displayName !== undefined ? input.displayName : (profile?.displayName ?? null),
    approvalDueAt: input.approvalDueAt !== undefined ? iso(input.approvalDueAt) : (profile?.approvalDueAt ?? null),
    approvedAt: input.approvedAt !== undefined ? iso(input.approvedAt) : (profile?.approvedAt ?? null),
    approvedByUserId: input.approvedByUserId !== undefined ? input.approvedByUserId : (profile?.approvedByUserId ?? null),
    disabledAt: input.disabledAt !== undefined ? iso(input.disabledAt) : (profile?.disabledAt ?? null),
    disabledReason: input.disabledReason !== undefined ? input.disabledReason : (profile?.disabledReason ?? null),
    legacyAccountStatus: input.accountStatus ?? profile?.legacyAccountStatus ?? null,
  });
  return findCmUserById(userId);
};
