// Durable host-issued evidence ledger (lot E7, E8 answer 3). The host
// keeps, per candidate, the store/scope/invocation-or-continuation mapping,
// the envelope binding, the reservation/terminal/ambiguous state and the
// receipt/cursor reconciliation. Rehydration re-establishes live authority
// from these records; refusing on an empty or unknown ledger is correct
// until then. First-write wins per candidate (first-proof parity); a
// repeated identical record is a no-op, never a second effect.

import { StorageDeniedError } from '../storage/errors.js';
import { validateStorageScope, type StorageScope } from '../storage/contracts.js';

export type HostLedgerState = 'reserved' | 'terminal' | 'ambiguous';

export interface HostLedgerEntry {
  readonly candidateId: string;
  readonly storeId: string;
  readonly scope: StorageScope;
  readonly invocationId: string;
  readonly continuationIds: readonly string[];
  readonly envelopeDigest: string;
  readonly state: HostLedgerState;
  readonly receipt: unknown;
  readonly cursor: string | null;
}

export interface MemoryHostLedger {
  readonly record: (entry: HostLedgerEntry) => HostLedgerEntry;
  readonly read: (candidateId: string) => HostLedgerEntry | null;
  readonly recordContinuation: (candidateId: string, invocationId: string) => HostLedgerEntry;
  readonly markTerminal: (candidateId: string, receipt: unknown, cursor: string | null) => HostLedgerEntry;
  readonly snapshot: () => readonly HostLedgerEntry[];
  readonly restore: (entries: readonly HostLedgerEntry[]) => void;
}

/** Read-only recovery evidence: envelope binding, state, receipt and cursor. */
export interface HostRecoveryProof {
  readonly candidateId: string;
  readonly storeId: string;
  readonly scope: StorageScope;
  readonly envelopeDigest: string;
  readonly state: HostLedgerState;
  readonly receipt: unknown;
  readonly cursor: string | null;
}

/**
 * Proof-only recovery (E8 answer 4): return the retained evidence for
 * admission-outcome recovery and journal-replay decisions without applying
 * any effect. Unknown candidates and foreign scopes are refused; an empty
 * ledger refuses. By construction this path cannot write.
 */
export const proveForRecovery = (
  ledger: MemoryHostLedger,
  candidateId: string,
  scope?: StorageScope,
): HostRecoveryProof => {
  const retained = ledger.read(candidateId);
  if (!retained) throw new StorageDeniedError('no retained evidence for this candidate');
  if (scope !== undefined) {
    if (!validateStorageScope(scope).ok) throw new StorageDeniedError('recovery scope must be valid');
    if (scope.tenantId !== retained.scope.tenantId || scope.workspaceId !== retained.scope.workspaceId) {
      throw new StorageDeniedError('recovery scope does not match the retained evidence');
    }
  }
  return Object.freeze({
    candidateId: retained.candidateId,
    storeId: retained.storeId,
    scope: retained.scope,
    envelopeDigest: retained.envelopeDigest,
    state: retained.state,
    receipt: retained.receipt,
    cursor: retained.cursor,
  });
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const checkEntry = (entry: HostLedgerEntry): void => {
  if (typeof entry !== 'object' || entry === null) throw new StorageDeniedError('ledger entry must be an object');
  if (!nonEmpty(entry.candidateId) || !nonEmpty(entry.storeId) || !nonEmpty(entry.invocationId)) {
    throw new StorageDeniedError('ledger entry requires candidate, store and invocation identity');
  }
  if (!validateStorageScope(entry.scope).ok) throw new StorageDeniedError('ledger entry requires a valid scope');
  if (!nonEmpty(entry.envelopeDigest)) throw new StorageDeniedError('ledger entry requires an envelope binding');
  if (entry.state !== 'reserved' && entry.state !== 'terminal' && entry.state !== 'ambiguous') {
    throw new StorageDeniedError('ledger entry requires a known state');
  }
};

/** In-memory ledger for composition and tests; the durable PG backing lands with the ledger asset. */
export const createMemoryHostLedger = (): MemoryHostLedger => {
  const entries = new Map<string, HostLedgerEntry>();
  return {
    record: (entry) => {
      checkEntry(entry);
      const existing = entries.get(entry.candidateId);
      if (existing) return existing;
      const stored = Object.freeze({
        ...entry,
        continuationIds: Object.freeze([...(entry.continuationIds ?? [])]),
        scope: Object.freeze({ ...entry.scope }),
      });
      entries.set(entry.candidateId, stored);
      return stored;
    },
    read: (candidateId) => entries.get(candidateId) ?? null,
    snapshot: () => Object.freeze([...entries.values()]),
    restore: (restored) => {
      if (!Array.isArray(restored)) throw new StorageDeniedError('ledger restore requires an entry list');
      const fresh = new Map<string, HostLedgerEntry>();
      for (const entry of restored) {
        checkEntry(entry);
        if (fresh.has(entry.candidateId)) throw new StorageDeniedError('ledger restore carries a duplicate candidate');
        fresh.set(
          entry.candidateId,
          Object.freeze({
            ...entry,
            continuationIds: Object.freeze([...(entry.continuationIds ?? [])]),
            scope: Object.freeze({ ...entry.scope }),
          }),
        );
      }
      entries.clear();
      for (const [candidateId, stored] of fresh) entries.set(candidateId, stored);
    },
    recordContinuation: (candidateId, invocationId) => {
      const existing = entries.get(candidateId);
      if (!existing) throw new StorageDeniedError('cannot continue an unknown ledger entry');
      if (!nonEmpty(invocationId)) throw new StorageDeniedError('continuation requires a fresh invocation identity');
      if (invocationId === existing.invocationId || existing.continuationIds.includes(invocationId)) {
        throw new StorageDeniedError('copied invocation fields never grant a continuation');
      }
      const stored = Object.freeze({
        ...existing,
        continuationIds: Object.freeze([...existing.continuationIds, invocationId]),
      });
      entries.set(candidateId, stored);
      return stored;
    },
    markTerminal: (candidateId, receipt, cursor) => {
      const existing = entries.get(candidateId);
      if (!existing) throw new StorageDeniedError('cannot complete an unknown ledger entry');
      const stored = Object.freeze({ ...existing, state: 'terminal' as const, receipt, cursor });
      entries.set(candidateId, stored);
      return stored;
    },
  };
};
