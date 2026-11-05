/**
 * G2 test double — in-memory PrincipalDirectoryPort (converged-r2 §2.3).
 *
 * The directory is the host-trusted side of the model boundary: it knows the
 * internal principal ids (here distinct from the opaque `userRef`s) and full
 * emails; the package must project every model-visible output to
 * `userRef` + masked `emailHint`. `resolvePrincipal` is scope-filtered (an
 * out-of-scope userRef is indistinguishable from an unknown one); approval is
 * NOT part of resolution — the package merges every resolution/approval
 * failure into the single `person_not_shareable` error.
 */
import type { DirectoryPerson, PrincipalDirectoryPort } from '../../src/server/ports.js';

export interface MemoryDirectoryAccount {
  /** Internal principal id (storage form, never model-visible). */
  readonly internalId: string;
  /** Opaque model-facing reference. */
  readonly userRef: string;
  readonly displayName: string;
  readonly email: string;
  readonly approved?: boolean;
  /** Scopes where the account exists; defaults to the directory scope. */
  readonly scopes?: readonly string[];
}

export interface MemoryDirectory extends PrincipalDirectoryPort {
  setApproved(internalId: string, value: boolean): void;
  /** R5 test double for a deleted account: the person is gone (describe
   * returns undefined, search excludes it) but the userRef tombstone still
   * resolves so the dormant grant can be revoked as cleanup. */
  deletePrincipal(internalId: string): void;
  readonly accounts: readonly (MemoryDirectoryAccount & { approved: boolean; scopes: readonly string[] })[];
}

const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();


export function createMemoryDirectory(scope: string, accounts: readonly MemoryDirectoryAccount[]): MemoryDirectory {
  const state = accounts.map((account) => ({
    ...account, approved: account.approved ?? true, scopes: account.scopes ?? [scope],
  }));
  const tombstones = new Map<string, { internalId: string; scopes: readonly string[] }>();
  const person = (account: (typeof state)[number]): DirectoryPerson =>
    ({ userRef: account.userRef, displayName: account.displayName, email: account.email });
  return {
    accounts: state,
    setApproved(internalId, value) {
      const account = state.find((entry) => entry.internalId === internalId);
      if (account) account.approved = value;
    },
    deletePrincipal(internalId) {
      const index = state.findIndex((entry) => entry.internalId === internalId);
      if (index === -1) return;
      const [removed] = state.splice(index, 1);
      tombstones.set(removed.userRef, { internalId: removed.internalId, scopes: removed.scopes });
    },
    async searchPeople(scopeId, query, limit) {
      const needle = fold(query);
      return state
        .filter((account) => account.scopes.includes(scopeId) && account.approved &&
          (fold(account.displayName).includes(needle) || fold(account.email).includes(needle)))
        .slice(0, Math.max(1, limit))
        .map(person);
    },
    async resolvePrincipal(scopeId, userRef) {
      const account = state.find((entry) => entry.userRef === userRef && entry.scopes.includes(scopeId));
      if (account) return account.internalId;
      const tombstone = tombstones.get(userRef);
      return tombstone && tombstone.scopes.includes(scopeId) ? tombstone.internalId : undefined;
    },
    async describePrincipal(_scopeId, principalId) {
      const account = state.find((entry) => entry.internalId === principalId);
      return account === undefined ? undefined : person(account);
    },
  };
}
