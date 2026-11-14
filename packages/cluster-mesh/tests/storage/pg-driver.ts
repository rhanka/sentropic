import { createRequire } from 'node:module';
import type { InjectedPgDriver, PgSession, SqlResult, SqlStatement } from '../../src/storage/postgres/protocol.js';
interface Client {
  processID: number;
  query(text: string, values?: readonly unknown[]): Promise<SqlResult>;
  release(destroy?: boolean): void;
}
interface Pool { connect(): Promise<Client>; query(text: string, values?: readonly unknown[]): Promise<SqlResult>; end(): Promise<void>; }
export const pgEnabled = Boolean(process.env.CM_PG_URL);
export const testPgDriver = (): { driver: InjectedPgDriver; close(): Promise<void> } => {
  const pg = createRequire(import.meta.url)('pg') as { Pool: new (options: unknown) => Pool };
  const pool = new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 8, connectionTimeoutMillis: 2000 });
  // Cancellation must not queue behind the transactions whose deadlines expired.
  let control: Pool | undefined;
  return {
    close: async () => { try { await pool.end(); } finally { await control?.end(); } },
    driver: { transaction: async (options, operation) => {
      const client = await pool.connect();
      let phase: 'statement' | 'commit' = 'statement';
      let expired = false;
      let cancellation: Promise<SqlResult> | undefined;
      const timer = setTimeout(() => {
        expired = true;
        control ??= new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 1, connectionTimeoutMillis: 2000 });
        cancellation = control.query('SELECT pg_cancel_backend($1)', [client.processID]);
        // Observe rejection immediately; the transaction awaits it before rollback.
        void cancellation.catch(() => undefined);
      }, options.deadlineMs);
      try {
        await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}`);
        const session: PgSession = { execute: (statement: SqlStatement) => {
          if (expired) throw new Error('Postgres fixture transaction deadline expired');
          return client.query(statement.text, statement.values);
        } };
        const result = await operation(session);
        if (expired) throw new Error('Postgres fixture transaction deadline expired');
        phase = 'commit';
        await client.query('COMMIT');
        if (expired) throw new Error('Postgres fixture transaction deadline expired');
        return result;
      } catch (error) {
        // Destroying a socket alone leaves the backend running with its locks.
        // Await cancellation, then roll back on that same session before release.
        try { await cancellation; }
        finally { await client.query('ROLLBACK').catch(() => undefined); }
        if (error && typeof error === 'object' && phase === 'commit' && !('code' in error)) Object.assign(error, { phase, outcome: 'unknown' });
        throw error;
      } finally { clearTimeout(timer); client.release(expired); }
    } },
  };
};
