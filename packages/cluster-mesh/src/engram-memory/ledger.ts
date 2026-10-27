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
  readonly envelopeDigest: string;
  readonly state: HostLedgerState;
  readonly receipt: unknown;
  readonly cursor: string | null;
}

export interface MemoryHostLedger {
  readonly record: (entry: HostLedgerEntry) => HostLedgerEntry;
  readonly read: (candidateId: string) => HostLedgerEntry | null;
  readonly markTerminal: (candidateId: string, receipt: unknown, cursor: string | null) => HostLedgerEntry;
}

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
      const stored = Object.freeze({ ...entry, scope: Object.freeze({ ...entry.scope }) });
      entries.set(entry.candidateId, stored);
      return stored;
    },
    read: (candidateId) => entries.get(candidateId) ?? null,
    markTerminal: (candidateId, receipt, cursor) => {
      const existing = entries.get(candidateId);
      if (!existing) throw new StorageDeniedError('cannot complete an unknown ledger entry');
      const stored = Object.freeze({ ...existing, state: 'terminal' as const, receipt, cursor });
      entries.set(candidateId, stored);
      return stored;
    },
  };
};
