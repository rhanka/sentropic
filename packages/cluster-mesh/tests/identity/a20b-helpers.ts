// A2.0b shared acceptance fixtures: dual-profile custody environments with
// real durable stores. PostgreSQL requires CM_PG_URL and fails loudly when
// it is absent; SQLite uses the file-backed qualified engine and reopens the
// same file to prove persistence. No skips, no doubles on the qualified path.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import type { SqliteConnection } from '../../src/storage/sqlite/connection.js';
import { openSqliteEngine, type SqliteEngine } from '../../src/storage/sqlite/engine.js';
import { applyIdentitySqliteSchema } from '../../src/identity/sqlite.js';
import { identityEnforcementPgSchema } from '../../src/identity/postgres.js';
import { identityA22PostgresDdl, IDENTITY_A22_SQLITE_DDL } from '../../src/identity-stores/tenancy-schema.js';
import { identitySchemaStatements } from '../../src/storage/identity/schema.js';
import type { IdentityUnitOfWorkV1 } from '../../src/identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../src/identity-contracts/custody-errors.js';
import { createPostgresIdentityHostV1, createPostgresIdentityUnitOfWorkV1, type PostgresCustodyHandle } from '../../src/storage/identity/custody-postgres.js';
import { createSqliteIdentityHostV1, createSqliteIdentityUnitOfWorkV1, type SqliteCustodyHandle } from '../../src/storage/identity/custody-sqlite.js';
import type { CustodyOpHost } from '../../src/storage/identity/custody-host.js';

export const NOW = '2026-11-01T12:00:00.000Z';
export const LATER = '2026-11-01T12:30:00.000Z';
export const EXPIRED = '2026-11-01T11:00:00.000Z';

const live: { close(): void | Promise<void> }[] = [];
afterAll(async () => {
  for (const entry of live.splice(0)) {
    try {
      await entry.close();
    } catch {
      // Already closed by reopen scenarios.
    }
  }
});

export interface PostgresEnv {
  readonly profile: 'postgres';
  readonly schema: string;
  readonly unitOfWork: IdentityUnitOfWorkV1<PostgresCustodyHandle>;
  readonly raw: InjectedPgDriver;
}

let sharedPg: { readonly driver: InjectedPgDriver; readonly close: () => Promise<void> } | null = null;

const requirePgDriver = async (): Promise<{ readonly driver: InjectedPgDriver; readonly close: () => Promise<void> }> => {
  if (!process.env.CM_PG_URL) {
    throw new Error('A2.0b qualification requires CM_PG_URL; the PostgreSQL profile must not be skipped');
  }
  if (!sharedPg) {
    const { testPgDriver } = await import('../storage/pg-driver.js');
    const opened = testPgDriver();
    sharedPg = opened;
    live.push({ close: () => opened.close() });
  }
  return sharedPg;
};

const randomSchema = (): string => `a20b_${randomBytes(6).toString('hex')}`;

export const openPostgresEnv = async (): Promise<PostgresEnv> => {
  const { driver } = await requirePgDriver();
  const schema = randomSchema();
  const tenancyBody = identityA22PostgresDdl(schema)
    .split('\n')
    .filter((line) => !/^(BEGIN|COMMIT|SET LOCAL)/.test(line.trim()))
    .join('\n');
  await driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 15000 }, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${schema}"`, values: [] });
    for (const ddl of tenancyBody.split(';\n').map((part) => part.trim()).filter(Boolean)) {
      await session.execute({ text: ddl, values: [] });
    }
    for (const ddl of identityEnforcementPgSchema(schema)) {
      await session.execute({ text: ddl, values: [] });
    }
  });
  const host = createPostgresIdentityHostV1({ driver, schema });
  const unitOfWork = createPostgresIdentityUnitOfWorkV1({ schema, host });
  live.push({
    close: () => driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 15000 }, (session) => session.execute({ text: `DROP SCHEMA "${schema}" CASCADE`, values: [] }).then(() => undefined)).catch(() => undefined),
  });
  return { profile: 'postgres', schema, unitOfWork, raw: driver };
};

export interface SqliteEnv {
  readonly profile: 'sqlite';
  readonly dir: string;
  readonly path: string;
  readonly unitOfWork: IdentityUnitOfWorkV1<SqliteCustodyHandle>;
  readonly engine: SqliteEngine;
  readonly connection: SqliteConnection;
  reopen(): SqliteEnv;
}

export const openSqliteEnv = (): SqliteEnv => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-a20b-'));
  const path = join(dir, 'custody.db');
  const build = (): SqliteEnv => {
    const engine = openSqliteEngine({ path, moduleId: 'identity-a20b' });
    // One transaction for the whole DDL batch (SQLite DDL is transactional):
    // with synchronous=FULL each autocommitted statement would fsync on its
    // own, which dominates setup cost on a loaded host. Same statements, one
    // commit — mirrors the single-transaction DDL batch in openPostgresEnv.
    engine.db.exec('BEGIN IMMEDIATE');
    try {
      for (const ddl of identitySchemaStatements('sqlite', '')) engine.db.exec(ddl);
      engine.db.exec(IDENTITY_A22_SQLITE_DDL);
      applyIdentitySqliteSchema(engine.db);
      engine.db.exec('COMMIT');
    } catch (error) {
      try { engine.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      engine.close();
      throw error;
    }
    // Schema is already applied above in one transaction; skip the host's own
    // per-statement autocommitted re-application.
    const host = createSqliteIdentityHostV1({ connection: engine.db, applySchema: false });
    const unitOfWork = createSqliteIdentityUnitOfWorkV1({ host });
    const env: SqliteEnv = {
      profile: 'sqlite',
      dir,
      path,
      unitOfWork,
      engine,
      connection: engine.db,
      reopen: (): SqliteEnv => {
        try {
          engine.close();
        } catch {
          // Already closed.
        }
        return build();
      },
    };
    return env;
  };
  const env = build();
  live.push({ close: () => { try { env.engine.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true }); } });
  return env;
};

export type AnyEnv = { readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost> };

/** PostgreSQL legs run only when the qualification lane provides CM_PG_URL. */
export { pgEnabled } from '../storage/pg-driver.js';

export const asOpHost = (unitOfWork: IdentityUnitOfWorkV1<PostgresCustodyHandle> | IdentityUnitOfWorkV1<SqliteCustodyHandle>): IdentityUnitOfWorkV1<CustodyOpHost> =>
  unitOfWork as unknown as IdentityUnitOfWorkV1<CustodyOpHost>;

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const randomBase64Url = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Deterministic 96-byte RFC 7515 Appendix-style COSE key (OKP, synthetic). */
export const syntheticCoseKey = (seed: string): string =>
  Buffer.from(JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: sha256Hex(seed).slice(0, 44) }), 'utf8').toString('base64url');

export interface FixtureBusinessState {
  failAt: null | 'delete' | 'assert';
  reachedDelete: boolean;
  reachedAssert: boolean;
}

import type { BusinessDeletionPlanV1 as PlanV1, BusinessDeletionPortV1 as PortV1 } from '../../src/identity-contracts/custody.js';

/** Transactional business participant over the exact host transaction. */
export const createFixtureBusiness = (input: {
  readonly handlerId: 'self_account' | 'admin_account';
  readonly plan: PlanV1;
  readonly state: FixtureBusinessState;
}): {
  readonly business: PortV1<CustodyOpHost> & { resolvePlan(userId: string, tx: CustodyOpHost): Promise<PlanV1> };
  setup(host: CustodyOpHost, rows: readonly { readonly ownerId: string; readonly workspaceId: string; readonly payload: string }[]): Promise<void>;
  rows(host: CustodyOpHost): Promise<readonly { readonly ownerId: string; readonly workspaceId: string }[]>;
} => {
  const exec = async (host: CustodyOpHost, text: string, values: readonly (string | number | null)[]): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly changes: number }> => {
    if (host.profile === 'postgres') {
      const session = host.raw as { execute(stmt: { text: string; values: readonly unknown[] }): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number | null }> };
      const isSelect = text.trimStart().toUpperCase().startsWith('SELECT');
      const pgText = isSelect ? text : text.split('?').map((part, index, parts) => (index < parts.length - 1 ? `${part}$${index + 1}` : part)).join('');
      const result = await session.execute({ text: pgText, values });
      return { rows: result.rows, changes: result.rowCount ?? 0 };
    }
    const connection = host.raw as { prepare(sql: string): { all(...v: unknown[]): readonly Record<string, unknown>[]; run(...v: unknown[]): { changes: number | bigint } }; exec(sql: string): void };
    if (text.trimStart().toUpperCase().startsWith('SELECT')) {
      return { rows: connection.prepare(text).all(...values), changes: 0 };
    }
    const result = connection.prepare(text).run(...values) as { changes: number | bigint };
    return { rows: [], changes: Number(result.changes) };
  };
  const business = {
    handlerId: input.handlerId,
    resolvePlan: async (userId: string, _tx: CustodyOpHost): Promise<PlanV1> => {
      void _tx;
      if (userId !== input.plan.userId) throw new Error('unknown subject');
      return input.plan;
    },
    deleteRows: async (plan: PlanV1, host: CustodyOpHost) => {
      input.state.reachedDelete = true;
      if (input.state.failAt === 'delete') throw new Error('injected-business');
      await exec(host, 'CREATE TABLE IF NOT EXISTS "biz_rows" ("owner_id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "payload" TEXT NOT NULL, PRIMARY KEY ("owner_id", "workspace_id"))', []);
      let deleted = 0;
      for (const workspaceId of plan.workspaceIdsToDelete) {
        deleted += (await exec(host, 'DELETE FROM "biz_rows" WHERE "workspace_id" = ?', [workspaceId])).changes;
      }
      deleted += (await exec(host, 'DELETE FROM "biz_rows" WHERE "owner_id" = ?', [plan.userId])).changes;
      return { handlerId: input.handlerId, deletedRows: { biz_rows: deleted } };
    },
    assertNoOrphans: async (plan: PlanV1, host: CustodyOpHost) => {
      input.state.reachedAssert = true;
      if (input.state.failAt === 'assert') throw new Error('injected-assert');
      const remaining = await exec(host, 'SELECT "owner_id", "workspace_id" FROM "biz_rows" WHERE "owner_id" = ?', [plan.userId]);
      if (remaining.rows.length > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
      for (const workspaceId of plan.workspaceIdsToDelete) {
        const rows = await exec(host, 'SELECT "owner_id" FROM "biz_rows" WHERE "workspace_id" = ?', [workspaceId]);
        if (rows.rows.length > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
      }
    },
  };
  return {
    business,
    setup: async (host: CustodyOpHost, rows: readonly { readonly ownerId: string; readonly workspaceId: string; readonly payload: string }[]) => {
      await exec(host, 'CREATE TABLE IF NOT EXISTS "biz_rows" ("owner_id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "payload" TEXT NOT NULL, PRIMARY KEY ("owner_id", "workspace_id"))', []);
      for (const row of rows) {
        await exec(host, 'INSERT INTO "biz_rows" ("owner_id","workspace_id","payload") VALUES (?,?,?) ON CONFLICT("owner_id","workspace_id") DO NOTHING', [row.ownerId, row.workspaceId, row.payload]);
      }
    },
    rows: async (host: CustodyOpHost) => (await exec(host, 'SELECT "owner_id", "workspace_id" FROM "biz_rows" ORDER BY "owner_id", "workspace_id"', [])).rows.map((row) => ({ ownerId: String(row['owner_id']), workspaceId: String(row['workspace_id']) })),
  };
};


