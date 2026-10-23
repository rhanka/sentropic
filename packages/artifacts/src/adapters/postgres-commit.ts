/**
 * L3 (immo #861) — PostgreSQL finalization executor (spec r2 §3.1 A4).
 *
 * Owns every coordinator SQL statement against coordinator tables only
 * (`artifacts.operation_keys`, `artifacts.operation_receipts`). No domain
 * table, no policy table and no caller SQL here: host domain reads and
 * writes arrive through the participant and the provider-internal
 * transaction handle. Connections are raw pooled clients; the coordinator
 * owns BEGIN/COMMIT/rollback/release. No nested pool lease spans S3 I/O:
 * preparation happens before the coordinator acquires its client.
 */
import type { Pool, PoolClient } from 'pg';
import type {
  CommitExecutor,
  FinalizeConnection,
  StoredCommitReceipt,
} from '../server/commit/types.js';

interface ReceiptRow {
  storage_scope_id: string;
  internal_key: string;
  command_codec: string;
  command_hash: string;
  receipt: unknown;
  created_at: Date;
}

function toReceipt(row: ReceiptRow): StoredCommitReceipt {
  return {
    scopeId: row.storage_scope_id,
    internalKey: row.internal_key,
    commandHash: row.command_hash,
    codecVersion: row.command_codec,
    receipt: row.receipt,
    createdAt: row.created_at.toISOString(),
  };
}

class PgFinalizeConnection implements FinalizeConnection {
  private released = false;

  constructor(private readonly client: PoolClient) {}

  async query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    const result = await this.client.query(text, [...params]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async beginReadCommitted(): Promise<void> {
    await this.client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  }

  async lockOperationKey(scopeId: string, internalKey: string): Promise<void> {
    await this.client.query(
      `SELECT 1 FROM artifacts.operation_keys
       WHERE storage_scope_id = $1 AND internal_key = $2 FOR UPDATE`,
      [scopeId, internalKey],
    );
  }

  async readReceipt(scopeId: string, internalKey: string): Promise<StoredCommitReceipt | undefined> {
    const result = await this.client.query<ReceiptRow>(
      `SELECT storage_scope_id, internal_key, command_codec, command_hash, receipt, created_at
       FROM artifacts.operation_receipts
       WHERE storage_scope_id = $1 AND internal_key = $2`,
      [scopeId, internalKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toReceipt(row);
  }

  async insertReceipt(receipt: StoredCommitReceipt): Promise<void> {
    await this.client.query(
      `INSERT INTO artifacts.operation_receipts
         (storage_scope_id, internal_key, command_codec, command_hash, receipt)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        receipt.scopeId,
        receipt.internalKey,
        receipt.codecVersion,
        receipt.commandHash,
        JSON.stringify(receipt.receipt),
      ],
    );
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.client.query('ROLLBACK');
  }

  release(error?: unknown): void {
    if (this.released) throw new Error('finalization client already released');
    this.released = true;
    this.client.release(error === undefined ? undefined : error as Error);
  }
}

/** Create the PostgreSQL finalization executor over an injected pool (no DDL). */
export function createPostgresCommitExecutor(pool: Pool): CommitExecutor {
  return {
    async ensureCoordinationRow(scopeId: string, internalKey: string): Promise<void> {
      await pool.query(
        `INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [scopeId, internalKey],
      );
    },
    async beginFinalization(): Promise<FinalizeConnection> {
      const client = await pool.connect();
      const connection = new PgFinalizeConnection(client);
      await connection.beginReadCommitted();
      return connection;
    },
  };
}
