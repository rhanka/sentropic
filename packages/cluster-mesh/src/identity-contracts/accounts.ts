// Identity core contracts: user accounts and identity proofs (F02, F03).
// Account approval is the first approval; it never implies tenant membership.

import {
  AccountNotActiveError,
  AccountTransitionError,
  AdminUserProtectedError,
  IdentityConflictError,
  IdentityNotFoundError,
  ProofVerificationError,
  SelfActionForbiddenError,
} from './errors.js';
import type { IdentityProofStore, UserAccountStore, IdentityAuditPort } from './ports.js';
import {
  systemIdentityClock,
  type GlobalRole,
  type IdentityClock,
  type IdentityProof,
  type IdentityProofKind,
  type RegisterAccountInput,
  type UserAccount,
  type VerifiedProofSubject,
} from './types.js';

export interface UserAccountDomain {
  register(input: RegisterAccountInput, options?: { readonly firstAdmin?: boolean }): Promise<UserAccount>;
  approveAccount(userId: string, input: { readonly role: GlobalRole; readonly actorId: string }): Promise<UserAccount>;
  disableAccount(userId: string, actorId: string): Promise<UserAccount>;
  reactivateAccount(userId: string, actorId: string): Promise<UserAccount>;
  deleteAccount(userId: string, actorId: string): Promise<void>;
  getAccount(userId: string): Promise<UserAccount>;
  listUsers(): Promise<readonly UserAccount[]>;
  /** Self-service surface (F02): the caller acts on its own account only. */
  getSelf(userId: string): Promise<UserAccount>;
  disableSelf(userId: string): Promise<UserAccount>;
  deleteSelf(userId: string): Promise<void>;
}

function isProtectedAdmin(role: GlobalRole): boolean {
  return role === 'admin_app' || role === 'admin_org';
}

export function createUserAccounts(input: {
  readonly accounts: UserAccountStore;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): UserAccountDomain {
  const clock = input.clock ?? systemIdentityClock;
  async function requireAccount(userId: string): Promise<UserAccount> {
    const account = await input.accounts.findAccount(userId);
    if (!account) throw new IdentityNotFoundError('user', userId);
    return account;
  }
  function forbidSelfAction(userId: string, actorId: string, action: 'approve' | 'disable' | 'reactivate' | 'delete'): void {
    if (userId === actorId) throw new SelfActionForbiddenError(action);
  }
  return {
    async register(registerInput, options) {
      const existing = await input.accounts.findAccountByEmail(registerInput.email);
      if (existing) throw new IdentityConflictError('email', `Email is already registered: ${registerInput.email}`);
      const now = clock();
      const record: UserAccount = {
        userId: registerInput.userId,
        email: registerInput.email,
        accountStatus: options?.firstAdmin === true ? 'active' : 'pending_admin_approval',
        globalRole: options?.firstAdmin === true ? 'admin_app' : 'guest',
        createdAt: now,
        updatedAt: now,
      };
      await input.accounts.createAccount(record);
      await input.audit.append({ at: now, kind: 'account.registered', subjectId: record.userId });
      return record;
    },
    async approveAccount(userId, approval) {
      forbidSelfAction(userId, approval.actorId, 'approve');
      const account = await requireAccount(userId);
      if (account.accountStatus === 'deleted') throw new AccountNotActiveError(userId);
      const now = clock();
      await input.accounts.setAccountStatus(userId, 'active', now);
      const updated = await input.accounts.setGlobalRole(userId, approval.role, now);
      await input.audit.append({ at: now, kind: 'account.approved', actorId: approval.actorId, subjectId: userId });
      return updated;
    },
    async disableAccount(userId, actorId) {
      forbidSelfAction(userId, actorId, 'disable');
      const account = await requireAccount(userId);
      if (isProtectedAdmin(account.globalRole)) throw new AdminUserProtectedError('disable');
      if (account.accountStatus !== 'active') throw new AccountTransitionError();
      const now = clock();
      const updated = await input.accounts.setAccountStatus(userId, 'disabled', now);
      await input.audit.append({ at: now, kind: 'account.disabled', actorId, subjectId: userId });
      return updated;
    },
    async reactivateAccount(userId, actorId) {
      forbidSelfAction(userId, actorId, 'reactivate');
      const account = await requireAccount(userId);
      if (account.accountStatus !== 'disabled') throw new AccountTransitionError();
      const now = clock();
      const updated = await input.accounts.setAccountStatus(userId, 'active', now);
      await input.audit.append({ at: now, kind: 'account.reactivated', actorId, subjectId: userId });
      return updated;
    },
    async deleteAccount(userId, actorId) {
      forbidSelfAction(userId, actorId, 'delete');
      const account = await requireAccount(userId);
      if (isProtectedAdmin(account.globalRole)) throw new AdminUserProtectedError('delete');
      if (account.accountStatus !== 'disabled') throw new AccountTransitionError('User must be disabled before deletion');
      const now = clock();
      await input.accounts.deleteAccount(userId, now);
      await input.audit.append({ at: now, kind: 'account.deleted', actorId, subjectId: userId });
    },
    async getAccount(userId) {
      const account = await requireAccount(userId);
      if (account.accountStatus === 'deleted') throw new AccountNotActiveError(userId);
      return account;
    },
    async listUsers() {
      return input.accounts.listAccounts();
    },
    async getSelf(userId) {
      const account = await requireAccount(userId);
      if (account.accountStatus === 'deleted') throw new AccountNotActiveError(userId);
      return account;
    },
    async disableSelf(userId) {
      const account = await requireAccount(userId);
      if (account.accountStatus !== 'active') throw new AccountTransitionError();
      const now = clock();
      const updated = await input.accounts.setAccountStatus(userId, 'disabled', now);
      await input.audit.append({ at: now, kind: 'account.self_disabled', subjectId: userId });
      return updated;
    },
    async deleteSelf(userId) {
      const account = await requireAccount(userId);
      if (account.accountStatus !== 'disabled') throw new AccountTransitionError('User must be disabled before deletion');
      const now = clock();
      await input.accounts.deleteAccount(userId, now);
      await input.audit.append({ at: now, kind: 'account.self_deleted', subjectId: userId });
    },
  };
}

const SINGLE_USE_PROOFS: readonly IdentityProofKind[] = ['email_code', 'magic_link'];

export interface IdentityProofDomain {
  registerProof(input: {
    readonly proofId: string;
    readonly userId: string;
    readonly kind: IdentityProofKind;
    readonly provider?: string;
    readonly expiresAt?: string;
  }): Promise<IdentityProof>;
  verifyProof(input: { readonly proofId: string; readonly userId: string }, now: string): Promise<VerifiedProofSubject>;
  revokeProof(proofId: string, actorId: string): Promise<IdentityProof>;
}

export function createIdentityProofs(input: {
  readonly proofs: IdentityProofStore;
  readonly clock?: IdentityClock;
}): IdentityProofDomain {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async registerProof(proof) {
      const record: IdentityProof = { ...proof, createdAt: clock() };
      await input.proofs.addProof(record);
      return record;
    },
    async verifyProof(lookup, now) {
      const proof = await input.proofs.findProof(lookup.proofId);
      if (!proof) throw new ProofVerificationError('not_found');
      if (proof.userId !== lookup.userId) throw new ProofVerificationError('mismatch');
      if (proof.revokedAt) throw new ProofVerificationError('revoked');
      if (proof.expiresAt && proof.expiresAt <= now) throw new ProofVerificationError('expired');
      if (proof.consumedAt) throw new ProofVerificationError('consumed');
      if (SINGLE_USE_PROOFS.includes(proof.kind)) await input.proofs.markProofConsumed(proof.proofId, now);
      return { proofId: proof.proofId, userId: proof.userId, kind: proof.kind };
    },
    async revokeProof(proofId, _actorId) {
      const proof = await input.proofs.findProof(proofId);
      if (!proof) throw new ProofVerificationError('not_found');
      return input.proofs.revokeProof(proofId, clock());
    },
  };
}
