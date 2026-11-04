/**
 * U1 — SQLite finalization executor (spec r2 §3.1 A4), same CommitExecutor
 * seam as `createPostgresCommitExecutor`. One connection: beginFinalization
 * acquires the serialized writer and opens BEGIN IMMEDIATE, which SQLite
 * serializes against every other writer — stronger than the pg READ
 * COMMITTED unit, same coordinator-visible semantics (the operation-key row
 * lock is the writer mutex itself). Caller SQL goes through normalizeSql
 * ($N -> ?, casts and FOR UPDATE stripped). release(error) rolls back any
 * open transaction; with a single connection there is no pool to poison.
 */
import type {
  CommitExecutor,
  FinalizeConnection,
  StoredCommitReceipt,
} from '../server/commit/types.js';
import { runQuery, type SqliteDatabase } from './sqlite-sql.js';
import type { SqliteWriter } from './sqlite.js';

interface ReceiptRow {
  storage_scope_id: string;
  internal_key: string;
  command_codec: string;
  command_hash: string;
  receipt: string;
  created_at: string;
}

function toReceipt(row: ReceiptRow): StoredCommitReceipt {
  return {
    scopeId: row.storage_scope_id,
    internalKey: row.internal_key,
    commandHash: row.command_hash,
    codecVersion: row.command_codec,
    receipt: JSON.parse(row.receipt) as unknown,
    createdAt: row.created_at,
  };
}

/** Create the SQLite finalization executor over one database + writer. */
export function createSqliteCommitExecutor(db: SqliteDatabase, writer: SqliteWriter): CommitExecutor {
  return {
    async ensureCoordinationRow(scopeId: string, internalKey: string): Promise<void> {
      await writer.run(() => {
        runQuery(
          db, 'INSERT INTO operation_keys (storage_scope_id, internal_key) VALUES ($1, $2) ON CONFLICT (storage_scope_id, internal_key) DO NOTHING',
          [scopeId, internalKey],
        );
      });
    },
    async beginFinalization(): Promise<FinalizeConnection> {
      const releaseWriter = await writer.acquire();
      db.exec('BEGIN IMMEDIATE');
      let finished = false;
      let released = false;
      const finish = (): void => {
        if (!finished) {
          finished = true;
          try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
        }
      };
      return {
        query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> {
          // pg deferred-constraint directive has no SQLite equivalent; every
          // SQLite constraint is already immediate, which is what it asks for.
          if (/^\s*SET\s+CONSTRAINTS\b/i.test(text)) return Promise.resolve({ rows: [], rowCount: 0 });
          return Promise.resolve(runQuery<T>(db, text, params));
        },
        // BEGIN IMMEDIATE is already open; SQLite serializes writers, which
        // subsumes the pg READ COMMITTED + FOR UPDATE key lock.
        beginReadCommitted(): Promise<void> { return Promise.resolve(); },
        lockOperationKey(scopeId: string, internalKey: string): Promise<void> {
          runQuery(db, 'SELECT 1 FROM operation_keys WHERE storage_scope_id = $1 AND internal_key = $2', [scopeId, internalKey]);
          return Promise.resolve();
        },
        async readReceipt(scopeId: string, internalKey: string): Promise<StoredCommitReceipt | undefined> {
          const { rows } = runQuery<ReceiptRow>(
            db, `SELECT storage_scope_id, internal_key, command_codec, command_hash, receipt, created_at
              FROM operation_receipts WHERE storage_scope_id = $1 AND internal_key = $2`,
            [scopeId, internalKey],
          );
          return rows[0] === undefined ? undefined : toReceipt(rows[0]);
        },
        async insertReceipt(receipt: StoredCommitReceipt): Promise<void> {
          try {
            runQuery(
              db, `INSERT INTO operation_receipts (storage_scope_id, internal_key, command_codec, command_hash, receipt)
                VALUES ($1, $2, $3, $4, $5)`,
              [receipt.scopeId, receipt.internalKey, receipt.codecVersion, receipt.commandHash, JSON.stringify(receipt.receipt)],
            );
          } catch (error) {
            // Adapt the driver error to the pg code the coordinator's
            // isUniqueViolation() port contract expects.
            if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
              throw Object.assign(new Error(error.message, { cause: error }), { code: '23505' });
            }
            throw error;
          }
        },
        async commit(): Promise<void> {
          db.exec('COMMIT');
          finished = true;
        },
        async rollback(): Promise<void> {
          finish();
        },
        release(error?: unknown): void {
          if (released) throw new Error('finalization client already released');
          released = true;
          finish();
          releaseWriter();
          if (error !== undefined) {
            // Single connection: nothing to destroy; an uncertain COMMIT left
            // the file consistent (WAL), and the caller sees the error.
          }
        },
      };
    },
  };
}
