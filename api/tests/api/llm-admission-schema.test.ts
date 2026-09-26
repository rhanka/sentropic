import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { env } from '../../src/config/env';
import { db } from '../../src/db/client';

// G1a (BRDP-EX5): migration 0008 is expand-first, its constraints hold, pricing non-overlap is
// enforced by the B0-A4 single-writer protocol, and a disposable upgrade keeps historical rows.
const CONTROL_DIR = join(process.cwd(), 'drizzle/control');
const MIGRATION_FILE = '0008_llm_admission.sql';
const migrationSql = readFileSync(join(CONTROL_DIR, MIGRATION_FILE), 'utf8');
const journal = JSON.parse(readFileSync(join(CONTROL_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const NEW_TABLES = ['blocked_attempts', 'budget_holds', 'budgets', 'model_pricing', 'tenant_budget_strategy'];
const NEW_LEDGER_COLUMNS = ['attempts', 'budget_strategy_id', 'hold_id', 'principal_key', 'principal_kind',
  'pricing_version', 'quote_ref', 'reconciliation_state', 'result'];
const run = randomUUID().replace(/-/g, '').slice(0, 10);

const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)).rows as T[];

describe('0008_llm_admission — expand-first shape', () => {
  it('is the single journal entry after 0007 and is applied on this database', async () => {
    const last = journal.entries.at(-1)!;
    expect(journal.entries.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(last.tag).toBe('0008_llm_admission');
    const [applied] = await rows<{ hash: string; created_at: string }>(sql`
      SELECT hash, created_at FROM public.__drizzle_control_migrations ORDER BY created_at DESC LIMIT 1`);
    expect(Number(applied!.created_at)).toBe(last.when);
    expect(applied!.hash).toBe(createHash('sha256').update(migrationSql).digest('hex'));
  });

  it('only creates tables, adds nullable columns, new-column CHECKs and indexes', () => {
    const statements = migrationSql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean);
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE "control"\."cost_ledger" ADD (COLUMN|CONSTRAINT))/);
    }
    expect(migrationSql).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE|EXTENSION|EXCLUDE|gist)\b/i);
    expect(migrationSql).not.toMatch(/ALTER COLUMN|SET DATA TYPE|USING\s+"/i);
    for (const statement of statements.filter((s) => s.includes('ADD COLUMN'))) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT/);
    }
    for (const statement of statements.filter((s) => s.includes('ADD CONSTRAINT'))) {
      expect(statement).toMatch(/CHECK \("control"\."cost_ledger"\."\w+" IS NULL OR /);
    }
    expect(migrationSql).not.toContain('llm_identity');
  });

  it('keeps cost_ledger history-compatible: nullable new columns, unchanged CHECK and idempotency key', async () => {
    const columns = await rows<{ column_name: string; is_nullable: string; column_default: string | null }>(sql`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'control' AND table_name = 'cost_ledger' AND column_name IN (${sql.join(NEW_LEDGER_COLUMNS.map((c) => sql`${c}`), sql`, `)})
      ORDER BY column_name`);
    columns.sort((a, b) => a.column_name.localeCompare(b.column_name, 'en'));
    expect(columns).toEqual([...NEW_LEDGER_COLUMNS].sort((a, b) => a.localeCompare(b, 'en')).map((column_name) => ({ column_name, is_nullable: 'YES', column_default: null })));
    const [operation] = await rows<{ def: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'cost_ledger_operation_check'`);
    expect(operation!.def).toBe(`CHECK ((operation = ANY (ARRAY['generate'::text, 'stream'::text])))`);
    const [unique] = await rows<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'control' AND indexname = 'cost_ledger_idempotency_key_unique'`);
    expect(unique!.indexdef).toContain('UNIQUE INDEX');
  });

  it('creates the five G1a tables, pricing unique key without extension, and no identity table', async () => {
    const tables = await rows<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'control'
        AND table_name IN (${sql.join([...NEW_TABLES, 'llm_identity_workspaces'].map((t) => sql`${t}`), sql`, `)})
      ORDER BY table_name`);
    expect(tables.map((t) => t.table_name)).toEqual(NEW_TABLES);
    const [pricing] = await rows<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'model_pricing_provider_model_effective_from_unique'`);
    expect(pricing!.indexdef).toContain('UNIQUE INDEX');
    expect(pricing!.indexdef).toContain('(provider_id, model_id, effective_from)');
    expect(await rows(sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`)).toEqual([]);
  });
});

describe('0008_llm_admission — constraints', () => {
  const tenant = `llmadm-${run}`;
  afterEach(async () => {
    await db.execute(sql`DELETE FROM control.budgets WHERE tenant_id LIKE ${`${tenant}%`}`);
    await db.execute(sql`DELETE FROM control.tenant_budget_strategy WHERE tenant_id LIKE ${`${tenant}%`}`);
  });

  const failure = (statement: ReturnType<typeof sql>) => db.execute(statement).then(() => null, (error: unknown) => error);

  it('allows one active strategy per tenant and tenant-qualified budget scopes', async () => {
    const strategy = (id: string, status = 'active') => sql`INSERT INTO control.tenant_budget_strategy
      (id, tenant_id, funding_mode, key_sourcing_mode, status) VALUES (${id}, ${tenant}, 'tenant_pool', 'platform', ${status})`;
    await db.execute(strategy(`${tenant}-s1`));
    await db.execute(strategy(`${tenant}-s0`, 'retired'));
    expect(await failure(strategy(`${tenant}-s2`))).toMatchObject({ cause: { constraint: 'tenant_budget_strategy_active_tenant_unique' } });

    const budget = (id: string, tenantId: string) => sql`INSERT INTO control.budgets
      (id, tenant_id, scope_kind, scope_key, reset_at) VALUES (${id}, ${tenantId}, 'model', 'openai/gpt', now())`;
    await db.execute(budget(`${tenant}-b1`, tenant));
    await db.execute(budget(`${tenant}-b2`, `${tenant}-other`));
    expect(await failure(budget(`${tenant}-b3`, tenant))).toMatchObject({ cause: { constraint: 'budgets_tenant_scope_period_unique' } });
  });

  it.each([
    ['budgets_amounts_check', sql`INSERT INTO control.budgets (id, tenant_id, scope_kind, scope_key, reserved_micro_usd, reset_at) VALUES ('c1', 'llmadm-x', 'tenant', 't', -1, now())`],
    ['budgets_workspace_scope_check', sql`INSERT INTO control.budgets (id, tenant_id, scope_kind, scope_key, reset_at) VALUES ('c2', 'llmadm-x', 'workspace', 'w', now())`],
    ['model_pricing_window_check', sql`INSERT INTO control.model_pricing (id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok, effective_from, effective_to) VALUES ('c3', 'p', 'm', 1, 1, now(), now() - interval '1 day')`],
    ['model_pricing_rates_check', sql`INSERT INTO control.model_pricing (id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok, effective_from) VALUES ('c4', 'p', 'm', -1, 1, now())`],
    ['blocked_attempts_reason_check', sql`INSERT INTO control.blocked_attempts (id, request_id, tenant_id, principal_kind, principal_key, reason) VALUES ('c5', 'r', 't', 'user', 'u', 'free text')`],
    ['budget_holds_status_check', sql`INSERT INTO control.budget_holds (id, request_id, tenant_id, principal_kind, principal_key, budget_strategy_id, budget_ids, quote_ref, pricing_versions, liability_micro_usd, status, owner_ref, deadline_at) VALUES ('c6', 'r', 't', 'service', 's', 'b', '{}', 'q', '{}', 0, 'lost', 'o', now())`],
    ['cost_ledger_result_check', sql`INSERT INTO control.cost_ledger (id, idempotency_key, operation, provider_id, model_id, result) VALUES ('c7', 'c7', 'generate', 'p', 'm', 'free text')`],
  ])('enforces %s', async (constraint, statement) => {
    expect(await failure(statement)).toMatchObject({ cause: { constraint } });
  });
});

// B0-A4 single-writer checked insert, kept test-local until its home is named (BRANCH.md `blocked`).
// FOR UPDATE cannot lock an absent predecessor, so a transaction-scoped advisory lock keyed on
// (provider, model) serializes writers first; the unique key stays the last-resort guard.
interface PricingWrite { id: string; providerId: string; modelId: string; from: Date; to: Date | null }
const PAUSE_SECONDS = 0.2;

const insertPricingChecked = (write: PricingWrite, options: { lock: boolean }) =>
  db.transaction(async (tx) => {
    if (options.lock) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${write.providerId}), hashtext(${write.modelId}))`);
    }
    const existing = (await tx.execute(sql`
      SELECT id, effective_from, effective_to FROM control.model_pricing
      WHERE provider_id = ${write.providerId} AND model_id = ${write.modelId}
      ORDER BY effective_from FOR UPDATE`)).rows as Array<{ id: string; effective_from: Date; effective_to: Date | null }>;
    await tx.execute(sql`SELECT pg_sleep(${PAUSE_SECONDS})`); // widen the race window
    const end = write.to?.getTime() ?? Number.POSITIVE_INFINITY;
    let predecessor: string | null = null;
    for (const row of existing) {
      const from = new Date(row.effective_from).getTime();
      const to = row.effective_to ? new Date(row.effective_to).getTime() : Number.POSITIVE_INFINITY;
      if (row.effective_to === null && from < write.from.getTime()) { predecessor = row.id; continue; }
      if (from < end && write.from.getTime() < to) throw new Error('model_pricing_overlap');
    }
    if (predecessor) {
      await tx.execute(sql`UPDATE control.model_pricing SET effective_to = ${write.from}
        WHERE id = ${predecessor} AND effective_to IS NULL`);
    }
    await tx.execute(sql`INSERT INTO control.model_pricing
      (id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok, effective_from, effective_to)
      VALUES (${write.id}, ${write.providerId}, ${write.modelId}, 3000000, 15000000, ${write.from}, ${write.to})`);
  });

describe('model_pricing non-overlap (B0-A4) on real Postgres', () => {
  const provider = `llmadm-${run}`;
  const day = (n: number) => new Date(Date.UTC(2026, 9, n));
  afterEach(async () => {
    await db.execute(sql`DELETE FROM control.model_pricing WHERE provider_id = ${provider}`);
  });

  const race = async (model: string, a: Omit<PricingWrite, 'providerId' | 'modelId' | 'id'>,
    b: Omit<PricingWrite, 'providerId' | 'modelId' | 'id'>, lock = true) => {
    const outcomes = await Promise.allSettled([
      insertPricingChecked({ id: `${provider}-${model}-a`, providerId: provider, modelId: model, ...a }, { lock }),
      insertPricingChecked({ id: `${provider}-${model}-b`, providerId: provider, modelId: model, ...b }, { lock }),
    ]);
    const stored = await rows<{ id: string }>(sql`SELECT id FROM control.model_pricing
      WHERE provider_id = ${provider} AND model_id = ${model}`);
    return { fulfilled: outcomes.filter((o) => o.status === 'fulfilled').length, stored: stored.length };
  };

  it('two parallel overlapping first writes: exactly one succeeds', async () => {
    await expect(race('first', { from: day(1), to: day(20) }, { from: day(10), to: null })).resolves.toEqual({ fulfilled: 1, stored: 1 });
  });

  it('two parallel overlapping writes after an open predecessor: exactly one succeeds', async () => {
    await insertPricingChecked({ id: `${provider}-p`, providerId: provider, modelId: 'next', from: day(1), to: null }, { lock: true });
    await expect(race('next', { from: day(5), to: day(15) }, { from: day(10), to: day(25) })).resolves.toEqual({ fulfilled: 1, stored: 2 });
    const [closed] = await rows<{ effective_to: Date }>(sql`SELECT effective_to FROM control.model_pricing WHERE id = ${`${provider}-p`}`);
    expect([day(5).getTime(), day(10).getTime()]).toContain(new Date(closed!.effective_to).getTime());
  });

  it('FOR UPDATE alone does not serialize absent predecessors: without the lock both overlapping writes commit', async () => {
    await expect(race('unlocked', { from: day(1), to: day(20) }, { from: day(10), to: null }, false)).resolves.toEqual({ fulfilled: 2, stored: 2 });
  });

  it('equal effective_from without the writer lock is still refused by the unique key', async () => {
    await expect(race('same', { from: day(3), to: null }, { from: day(3), to: day(9) }, false)).resolves.toEqual({ fulfilled: 1, stored: 1 });
  });

  it('sequential supersession closes the open predecessor at the successor start', async () => {
    await insertPricingChecked({ id: `${provider}-s1`, providerId: provider, modelId: 'seq', from: day(1), to: null }, { lock: true });
    await insertPricingChecked({ id: `${provider}-s2`, providerId: provider, modelId: 'seq', from: day(8), to: null }, { lock: true });
    const windows = await rows<{ id: string; effective_to: Date | null }>(sql`SELECT id, effective_to FROM control.model_pricing
      WHERE provider_id = ${provider} AND model_id = 'seq' ORDER BY effective_from`);
    expect(windows.map((w) => [w.id, w.effective_to && new Date(w.effective_to).getTime()]))
      .toEqual([[`${provider}-s1`, day(8).getTime()], [`${provider}-s2`, null]]);
  });
});

// Disposable upgrade on scratch databases of this test Postgres only (never a shared database):
// public stream + control 0000..0007, historical ledger rows, clone as the pre-migration backup,
// upgrade to 0008, then restore the backup and re-upgrade it.
describe('0008_llm_admission — disposable upgrade and restore', () => {
  const names = { upgrade: `llm_adm_${run}_up`, backup: `llm_adm_${run}_bak`, copy: `llm_adm_${run}_copy` };
  const workDir = mkdtempSync(join(tmpdir(), 'llm-adm-'));
  const pools: Pool[] = [];
  const urlFor = (name: string) => { const url = new URL(env.DATABASE_URL); url.pathname = `/${name}`; return url.toString(); };
  const open = (name: string) => { const pool = new Pool({ connectionString: urlFor(name), max: 2 }); pools.push(pool); return pool; };
  const close = async (pool: Pool) => { pools.splice(pools.indexOf(pool), 1); await pool.end(); };
  const control = (folder: string) => ({ migrationsFolder: folder, migrationsTable: '__drizzle_control_migrations', migrationsSchema: 'public' });
  const LEDGER = `SELECT id, idempotency_key, user_id, workspace_id, operation, provider_id, model_id, input_tokens,
    output_tokens, usage_raw, cost_micro_usd, created_at FROM control.cost_ledger ORDER BY id`;
  const query = async (pool: Pool, text: string) => (await pool.query(text)).rows;

  const controlUpTo0007 = (): string => {
    const folder = join(workDir, 'control-0007');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    const entries = journal.entries.filter((entry) => entry.idx <= 7);
    for (const entry of entries) copyFileSync(join(CONTROL_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    return folder;
  };
  const upgradedState = async (pool: Pool) => ({
    migrations: Number((await query(pool, 'SELECT count(*) AS n FROM public.__drizzle_control_migrations'))[0].n),
    tables: (await query(pool, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'control'
      AND table_name IN ('${NEW_TABLES.join("','")}') ORDER BY table_name`)).map((row) => row.table_name),
    newRows: Number((await query(pool, `SELECT (SELECT count(*) FROM control.budgets) + (SELECT count(*) FROM control.model_pricing)
      + (SELECT count(*) FROM control.budget_holds) + (SELECT count(*) FROM control.blocked_attempts)
      + (SELECT count(*) FROM control.tenant_budget_strategy) AS n`))[0].n),
    attributed: Number((await query(pool, `SELECT count(*) AS n FROM control.cost_ledger WHERE ${NEW_LEDGER_COLUMNS
      .map((column) => `${column} IS NOT NULL`).join(' OR ')}`))[0].n),
    ledger: await query(pool, LEDGER),
  });

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    for (const name of Object.values(names)) await db.execute(sql.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    rmSync(workDir, { recursive: true, force: true });
  });

  it('upgrades 0007 → 0008 preserving null-cost history, and a restored backup re-upgrades identically', async () => {
    await db.execute(sql.raw(`CREATE DATABASE "${names.upgrade}"`));
    let pool = open(names.upgrade);
    await migrate(drizzle(pool), { migrationsFolder: join(process.cwd(), 'drizzle') });
    await migrate(drizzle(pool), control(controlUpTo0007()));
    expect(Number((await query(pool, 'SELECT count(*) AS n FROM public.__drizzle_control_migrations'))[0].n)).toBe(8);
    await pool.query(`INSERT INTO control.cost_ledger (id, idempotency_key, user_id, workspace_id, operation, provider_id, model_id)
      VALUES ('h1', 'h1', 'u1', 'w1', 'generate', 'openai', 'gpt-a'), ('h2', 'h2', NULL, NULL, 'stream', 'anthropic', 'claude-a')`);
    await pool.query(`INSERT INTO control.cost_ledger (id, idempotency_key, operation, provider_id, model_id, input_tokens,
      output_tokens, usage_raw, cost_micro_usd) VALUES ('h3', 'h3', 'generate', 'openai', 'gpt-a', 10, 5, '{"n":1}', 42)`);
    const history = await query(pool, LEDGER);
    expect(history.filter((row) => row.cost_micro_usd === null)).toHaveLength(2);
    await close(pool);
    await db.execute(sql.raw(`CREATE DATABASE "${names.backup}" TEMPLATE "${names.upgrade}"`));

    pool = open(names.upgrade);
    await migrate(drizzle(pool), control(CONTROL_DIR));
    const upgraded = await upgradedState(pool);
    expect(upgraded).toEqual({ migrations: 9, tables: NEW_TABLES, newRows: 0, attributed: 0, ledger: history });
    await close(pool);

    // Rollback-by-restore: the pre-migration backup still holds 0007 state and the same rows.
    const backup = open(names.backup);
    expect(Number((await query(backup, 'SELECT count(*) AS n FROM public.__drizzle_control_migrations'))[0].n)).toBe(8);
    expect(await query(backup, `SELECT to_regclass('control.budgets') AS t`)).toEqual([{ t: null }]);
    expect(await query(backup, LEDGER)).toEqual(history);
    await migrate(drizzle(backup), control(CONTROL_DIR));
    expect(await upgradedState(backup)).toEqual(upgraded);
    await close(backup);

    // A copy of the migrated database restores with the same migration state and rows.
    await db.execute(sql.raw(`CREATE DATABASE "${names.copy}" TEMPLATE "${names.upgrade}"`));
    const copy = open(names.copy);
    expect(await upgradedState(copy)).toEqual(upgraded);
    await close(copy);
  });
});
