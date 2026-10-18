import { createRequire } from 'node:module';
import type { InjectedPgDriver, PgSession, SqlResult, SqlStatement } from '../../src/storage/postgres/protocol.js';
interface Client {
  query(text: string, values?: readonly unknown[]): Promise<SqlResult>;
  release(destroy?: boolean): void;
}
interface Pool { connect(): Promise<Client>; end(): Promise<void>; }
export const pgEnabled = Boolean(process.env.CM_PG_URL);
export const testPgDriver = (): { driver: InjectedPgDriver; close(): Promise<void> } => {
  const pg = createRequire(import.meta.url)('pg') as { Pool: new (options: unknown) => Pool };
  const pool = new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 8, connectionTimeoutMillis: 2000 });
  return {
    close: () => pool.end(),
    driver: { transaction: async (options, operation) => {
      const client = await pool.connect();
      let phase: 'statement' | 'commit' = 'statement';
      let expired = false;
      const timer = setTimeout(() => { expired = true; client.release(true); }, options.deadlineMs);
      try {
        await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}`);
        const session: PgSession = { execute: (statement: SqlStatement) => client.query(statement.text, statement.values) };
        const result = await operation(session);
        phase = 'commit';
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (!expired) await client.query('ROLLBACK').catch(() => undefined);
        if (error && typeof error === 'object' && phase === 'commit' && !('code' in error)) Object.assign(error, { phase, outcome: 'unknown' });
        throw error;
      } finally { clearTimeout(timer); if (!expired) client.release(); }
    } },
  };
};
