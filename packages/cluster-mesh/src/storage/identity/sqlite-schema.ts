import type { SqliteConnection } from '../sqlite/connection.js';

/** One durable schema commit, or a savepoint inside the caller's transaction. */
export const applyAtomicSqliteDdl = (connection: SqliteConnection, statements: readonly string[]): void => {
  connection.exec('SAVEPOINT identity_schema_install');
  try {
    connection.exec(`${statements.join(';\n')};\nRELEASE identity_schema_install`);
  } catch (error) {
    try {
      connection.exec('ROLLBACK TO identity_schema_install; RELEASE identity_schema_install');
    } catch {
      // Preserve the DDL failure if the engine already rolled back the transaction.
    }
    throw error;
  }
};
