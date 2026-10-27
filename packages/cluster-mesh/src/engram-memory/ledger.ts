// Durable host-issued evidence ledger (lot E7, E8 answer 3). The host
// keeps, per candidate, the store/scope/invocation-or-continuation mapping,
// the envelope binding, the reservation/terminal/ambiguous state and the
// receipt/cursor reconciliation. Rehydration re-establishes live authority
// from these records; refusing on an empty or unknown ledger is correct
// until then. First-write wins per candidate (first-proof parity); a
// repeated identical record is a no-op, never a second effect.

import { StorageDeniedError } from '../storage/errors.js';
import { validateStorageScope, type StorageScope } from '../storage/contracts.js';
import { quotePgIdentifier, type InjectedPgDriver, type PgSession } from '../storage/postgres/protocol.js';

export type HostLedgerState = 'reserved' | 'terminal' | 'ambiguous';

export interface HostLedgerEntry {
  readonly candidateId: string;
  readonly storeId: string;
  readonly scope: StorageScope;
  readonly invocationId: string;
  readonly hostPrincipal: string;
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
  /**
   * Drop every entry of a spent invocation (terminal candidates whose
   * continuation window closed). A later reattach for a drained candidate
   * surfaces NOT_FOUND; proof-only recovery is impossible once drained.
   */
  readonly drainInvocation: (invocationId: string) => number;
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

/**
 * First-write parity for terminal evidence (P2): repeating the identical
 * terminal (same receipt and cursor) is a no-op returning the retained
 * entry; a different receipt or cursor reconciles by overwriting.
 */
const isSameTerminal = (existing: HostLedgerEntry, receipt: unknown, cursor: string | null): boolean => {
  if (existing.state !== 'terminal') return false;
  try {
    return JSON.stringify(existing.receipt) === JSON.stringify(receipt ?? null) && existing.cursor === cursor;
  } catch {
    return false;
  }
};

const checkEntry = (entry: HostLedgerEntry): void => {
  if (typeof entry !== 'object' || entry === null) throw new StorageDeniedError('ledger entry must be an object');
  if (!nonEmpty(entry.candidateId) || !nonEmpty(entry.storeId) || !nonEmpty(entry.invocationId)) {
    throw new StorageDeniedError('ledger entry requires candidate, store and invocation identity');
  }
  if (!nonEmpty(entry.hostPrincipal)) {
    throw new StorageDeniedError('ledger entry requires the host principal');
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
      if (isSameTerminal(existing, receipt, cursor)) return existing;
      const stored = Object.freeze({ ...existing, state: 'terminal' as const, receipt, cursor });
      entries.set(candidateId, stored);
      return stored;
    },
    drainInvocation: (invocationId) => {
      if (!nonEmpty(invocationId)) throw new StorageDeniedError('ledger drain requires an invocation identity');
      let removed = 0;
      for (const [candidateId, entry] of entries) {
        if (entry.invocationId === invocationId) {
          entries.delete(candidateId);
          removed += 1;
        }
      }
      return removed;
    },
  };
};

/**
 * PG-backed host ledger (P1-5, asset `002-host-ledger.sql`). Same
 * first-write-wins semantics as the in-memory ledger, persisted per row in
 * `memory_host_ledger`. The table is applied by the migration owner (E2
 * wires the 002 asset into the manifest); opening against a schema without
 * the table is refused. Rehydration across a real reopen is a fresh handle
 * over the same schema — `snapshot()` feeds the in-memory authority seam.
 */
export interface MemoryPostgresHostLedger {
  readonly record: (entry: HostLedgerEntry) => Promise<HostLedgerEntry>;
  readonly read: (candidateId: string) => Promise<HostLedgerEntry | null>;
  readonly recordContinuation: (candidateId: string, invocationId: string) => Promise<HostLedgerEntry>;
  readonly markTerminal: (candidateId: string, receipt: unknown, cursor: string | null) => Promise<HostLedgerEntry>;
  readonly drainInvocation: (invocationId: string) => Promise<number>;
  readonly snapshot: () => Promise<readonly HostLedgerEntry[]>;
}

const LEDGER_TX = Object.freeze({ isolation: 'serializable' as const, readOnly: false, deadlineMs: 5000 });

const rowToEntry = (row: Readonly<Record<string, unknown>>): HostLedgerEntry => {
  const entry: HostLedgerEntry = {
    candidateId: row.candidate_id as string,
    storeId: row.store_id as string,
    scope: { tenantId: row.tenant_id as string, workspaceId: row.workspace_id as string },
    invocationId: row.invocation_id as string,
    hostPrincipal: row.host_principal as string,
    continuationIds: Object.freeze([...((row.continuation_ids as readonly string[] | null) ?? [])]),
    envelopeDigest: row.envelope_digest as string,
    state: row.state as HostLedgerState,
    receipt: (row.receipt as unknown) ?? null,
    cursor: (row.cursor as string | null) ?? null,
  };
  checkEntry(entry);
  return Object.freeze({ ...entry, scope: Object.freeze({ ...entry.scope }) });
};

const toReceiptJson = (receipt: unknown): string | null =>
  receipt === undefined || receipt === null ? null : JSON.stringify(receipt);

export const openMemoryPostgresHostLedger = async (
  pool: InjectedPgDriver,
  schema: string,
): Promise<MemoryPostgresHostLedger> => {
  if (typeof pool !== 'object' || pool === null || typeof pool.transaction !== 'function') {
    throw new StorageDeniedError('PG host ledger requires the injected host pool');
  }
  let table: string;
  try {
    table = `${quotePgIdentifier(schema)}.memory_host_ledger`;
  } catch {
    throw new StorageDeniedError('PG host ledger requires a valid projection schema');
  }
  try {
    await pool.transaction(LEDGER_TX, (session) =>
      session.execute({ text: `SELECT candidate_id FROM ${table} LIMIT 0`, values: [] }),
    );
  } catch {
    throw new StorageDeniedError('PG host ledger table is not installed; the 002 asset is not applied');
  }
  const run = <T>(operation: (session: PgSession) => Promise<T>): Promise<T> =>
    pool.transaction(LEDGER_TX, operation);
  const selectOne = async (candidateId: string): Promise<HostLedgerEntry | null> =>
    run(async (session) => {
      const result = await session.execute({
        text: `SELECT * FROM ${table} WHERE candidate_id = $1`,
        values: [candidateId],
      });
      const row = result.rows[0];
      return row ? rowToEntry(row) : null;
    });
  return {
    record: async (entry) => {
      checkEntry(entry);
      if (entry.cursor !== null && typeof entry.cursor !== 'string') {
        throw new StorageDeniedError('ledger entry requires a text cursor or null');
      }
      await run((session) =>
        session.execute({
          text: `INSERT INTO ${table}(candidate_id, store_id, tenant_id, workspace_id, invocation_id, host_principal, continuation_ids, envelope_digest, state, receipt, cursor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (candidate_id) DO NOTHING`,
          values: [
            entry.candidateId, entry.storeId, entry.scope.tenantId, entry.scope.workspaceId,
            entry.invocationId, entry.hostPrincipal, [...entry.continuationIds],
            entry.envelopeDigest, entry.state, toReceiptJson(entry.receipt), entry.cursor,
          ],
        }),
      );
      const stored = await selectOne(entry.candidateId);
      if (!stored) throw new StorageDeniedError('PG host ledger failed to retain the entry');
      return stored;
    },
    read: (candidateId) => selectOne(candidateId),
    recordContinuation: async (candidateId, invocationId) => {
      if (!nonEmpty(invocationId)) throw new StorageDeniedError('continuation requires a fresh invocation identity');
      // Atomic: the guard runs in the single UPDATE statement, so two
      // concurrent continuations with the same invocation cannot both win.
      const updated = await run(async (session) => {
        const result = await session.execute({
          text: `UPDATE ${table} SET continuation_ids = array_append(continuation_ids, $2) WHERE candidate_id = $1 AND invocation_id <> $2 AND NOT ($2 = ANY(continuation_ids)) RETURNING *`,
          values: [candidateId, invocationId],
        });
        const row = result.rows[0];
        return row ? rowToEntry(row) : null;
      });
      if (updated) return updated;
      const current = await selectOne(candidateId);
      if (!current) throw new StorageDeniedError('cannot continue an unknown ledger entry');
      throw new StorageDeniedError('copied invocation fields never grant a continuation');
    },
    markTerminal: async (candidateId, receipt, cursor) => {
      if (cursor !== null && typeof cursor !== 'string') {
        throw new StorageDeniedError('ledger entry requires a text cursor or null');
      }
      // Atomic: an identical terminal repeat skips the write in the single
      // UPDATE statement (first-write parity, no second effect); a different
      // receipt or cursor reconciles by overwriting.
      const updated = await run(async (session) => {
        const result = await session.execute({
          text: `UPDATE ${table} SET state = 'terminal', receipt = $2::jsonb, cursor = $3 WHERE candidate_id = $1 AND NOT (state = 'terminal' AND receipt = $2::jsonb AND cursor IS NOT DISTINCT FROM $3) RETURNING *`,
          values: [candidateId, toReceiptJson(receipt), cursor],
        });
        const row = result.rows[0];
        return row ? rowToEntry(row) : null;
      });
      if (updated) return updated;
      const current = await selectOne(candidateId);
      if (!current) throw new StorageDeniedError('cannot complete an unknown ledger entry');
      return current;
    },
    drainInvocation: (invocationId) => {
      if (!nonEmpty(invocationId)) throw new StorageDeniedError('ledger drain requires an invocation identity');
      return run(async (session) => {
        const result = await session.execute({
          text: `DELETE FROM ${table} WHERE invocation_id = $1`,
          values: [invocationId],
        });
        return result.rowCount ?? 0;
      });
    },
    snapshot: () =>
      run(async (session) => {
        const result = await session.execute({
          text: `SELECT * FROM ${table} ORDER BY candidate_id`,
          values: [],
        });
        return Object.freeze(result.rows.map(rowToEntry));
      }),
  };
};
