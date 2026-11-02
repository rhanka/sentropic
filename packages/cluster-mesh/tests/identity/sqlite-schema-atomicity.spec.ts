import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SqliteConnection } from '../../src/storage/sqlite/connection.js';
import { openSqliteEngine } from '../../src/storage/sqlite/engine.js';
import { applySqliteIdentityCoreSchema } from '../../src/storage/identity/sqlite.js';
import { createSqliteCustodyStores } from '../../src/storage/identity/custody-sqlite.js';
import { applyIdentitySqliteSchema } from '../../src/identity/sqlite.js';

const cases = [
  { name: 'core', apply: applySqliteIdentityCoreSchema, broken: 'identity_single_use_proofs', created: 'identity_user_accounts' },
  { name: 'custody', apply: createSqliteCustodyStores, broken: 'identity_single_use_proofs', created: 'identity_user_accounts' },
  { name: 'enforcement', apply: applyIdentitySqliteSchema, broken: 'cm_identity_escalation_entries', created: 'cm_identity_conversation_sessions' },
] as const;

describe.each(cases)('SQLite $name schema installation', ({ name, apply, broken, created }) => {
  const withDatabase = (operation: (db: SqliteConnection) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-schema-atomicity-'));
    const engine = openSqliteEngine({ path: join(dir, 'schema.db'), moduleId: 'identity-schema' });
    try { operation(engine.db); } finally {
      engine.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const install = (db: SqliteConnection): void => {
    if (name === 'custody') createSqliteCustodyStores({ connection: db });
    else (apply as (connection: SqliteConnection) => void)(db);
  };
  const hasTable = (db: SqliteConnection, table: string): boolean =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;

  it('rolls back the complete schema when an incompatible table prevents index creation', () => {
    withDatabase((db) => {
      db.exec(`CREATE TABLE "${broken}" (incompatible TEXT)`);
      expect(() => install(db)).toThrow();
      expect(hasTable(db, created)).toBe(false);
      expect(hasTable(db, broken)).toBe(true);
      db.exec(`DROP TABLE "${broken}"`);
      install(db);
      expect(hasTable(db, created)).toBe(true);
    });
  });

  it('participates in the caller transaction without committing it', () => {
    withDatabase((db) => {
      db.exec('BEGIN IMMEDIATE');
      install(db);
      install(db);
      expect(hasTable(db, created)).toBe(true);
      db.exec('ROLLBACK');
      expect(hasTable(db, created)).toBe(false);
    });
  });
});
