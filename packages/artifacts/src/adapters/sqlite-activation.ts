/**
 * U1 — SQLite activation store, local equivalent of
 * `createPostgresActivationStore`. Same port (`PostgresActivationStore`), same
 * observable behaviour; the pg `artifact_host.<table>` names map to plain
 * `<table>` in the single database file (DDL: sql/sqlite/0002_activation.sql).
 *
 * Isolation: every operation runs inside one serialized writer transaction
 * (BEGIN IMMEDIATE), so the pg row locks (`FOR UPDATE` / `FOR SHARE`,
 * `SKIP LOCKED`) have no SQLite counterpart and are unnecessary — check-then-
 * write is atomic under the writer. The `exclusive` namespace lock of pg's
 * invalidate() is likewise implied. A COMMIT whose acknowledgement is lost
 * still raises ActivationCommitUnknownError, exactly like the pg adapter.
 *
 * DB time is `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)` ms,
 * evaluated once per statement (CTE) where a single reading matters.
 * The pg regex CHECKs are enforced here in code (SQLite has no REGEXP).
 */
import type { PoolClient } from 'pg';
import type { TicketBinding, TicketRecord, TicketStore } from '../content/grants.js';
import {
  ACTIVATION_MAX_TTL_SECONDS,
  ActivationCommitUnknownError,
  type ActivationAuthority,
  type ActivationConsumeInput,
  type BrowserFlowBinding,
  type BrowserFlowRecord,
  type BrowserFlowStore,
  type PostgresActivationStore,
} from './postgres-activation.js';
import type { SqliteDatabase } from './sqlite-sql.js';
import { runQuery } from './sqlite-sql.js';
import type { SqliteWriter } from './sqlite.js';

export type SqliteActivationStore = PostgresActivationStore;

/** DB milliseconds now, one reading per statement. */
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

/** Query client handed to the authority callback (pg hands a PoolClient). */
export interface SqliteQueryClient {
  query<T>(text: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const bindingKeys = ['subjectId', 'artifactId', 'releaseId', 'channel'] as const;
const flowKeys = [...bindingKeys, 'nonceDigest', 'sessionId', 'profileDigest', 'policyRevision', 'targetOrigin'] as const;

function text(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 ||
    value.includes('\0') || Buffer.from(value).toString('utf8') !== value) {
    throw new Error('invalid activation binding');
  }
  return value;
}
function binding(value: TicketBinding): TicketBinding {
  if (value.channel !== 'stable' && value.channel !== 'pinned') throw new Error('invalid activation channel');
  return { subjectId: text(value.subjectId), artifactId: text(value.artifactId),
    releaseId: text(value.releaseId), channel: value.channel };
}
function deadline(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid activation deadline');
  return value;
}
function flowBinding(value: BrowserFlowBinding): BrowserFlowBinding {
  const targetOrigin = text(value.targetOrigin);
  const url = new URL(targetOrigin);
  if (url.protocol !== 'https:' || url.origin !== targetOrigin) throw new Error('invalid activation origin');
  for (const digest of [value.nonceDigest, value.profileDigest]) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid activation digest');
  }
  return { ...binding(value), nonceDigest: value.nonceDigest, profileDigest: value.profileDigest,
    sessionId: text(value.sessionId), policyRevision: text(value.policyRevision), targetOrigin };
}

type Run = <T>(work: (client: SqliteQueryClient, generation: number) => Promise<T>) => Promise<T>;

const parse = <T>(row: { payload: string } | undefined): T | undefined =>
  row === undefined ? undefined : JSON.parse(row.payload) as T;

/** One serialized writer transaction: BEGIN IMMEDIATE … COMMIT (ROLLBACK on
 * throw). A lost COMMIT acknowledgement surfaces as ActivationCommitUnknownError. */
async function transaction<T>(
  db: SqliteDatabase, writer: SqliteWriter, namespace: string,
  work: (client: SqliteQueryClient, generation: number) => Promise<T>,
): Promise<T> {
  const release = await writer.acquire();
  let committing = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    runQuery(db, 'INSERT OR IGNORE INTO activation_namespaces (namespace) VALUES ($1)', [namespace]);
    const { rows } = runQuery<{ generation: number | bigint }>(
      db, 'SELECT generation FROM activation_namespaces WHERE namespace = $1', [namespace]);
    const client: SqliteQueryClient = {
      query: async <T>(text: string, params: readonly unknown[] = []) => runQuery<T>(db, text, params),
    };
    const result = await work(client, Number(rows[0]!.generation));
    committing = true;
    db.exec('COMMIT');
    return result;
  } catch (cause) {
    if (committing) throw new ActivationCommitUnknownError(cause);
    try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    throw cause;
  } finally {
    release();
  }
}

function recordStores(run: Run, namespace: string): Pick<PostgresActivationStore, 'tickets' | 'flows'> {
  const parameters = (id: string, generation: number) => [namespace, text(id), generation];
  const tickets: TicketStore = {
    async issue(value, ttlMs) {
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > ACTIVATION_MAX_TTL_SECONDS * 1000) {
        throw new Error('invalid activation lifetime');
      }
      const payload = { ...binding(value), ticketId: text(value.ticketId) };
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: string }>(
          `WITH issued AS (SELECT ${NOW_MS} AS ms)
           INSERT INTO activation_tickets (namespace, generation, payload, issued_ms)
           SELECT $1, $2, json_set($3, '$.expiresAt', ms + $4), ms FROM issued
           RETURNING payload`, [namespace, generation, JSON.stringify(payload), ttlMs]);
        return parse<TicketRecord>(rows[0])!;
      });
    },
    async put(value) {
      const payload: TicketRecord = { ...binding(value), ticketId: text(value.ticketId), expiresAt: deadline(value.expiresAt) };
      await run(async (client, generation) => {
        await client.query('INSERT INTO activation_tickets (namespace, generation, payload) VALUES ($1, $2, $3)',
          [namespace, generation, JSON.stringify(payload)]);
      });
    },
    async peek(id) {
      text(id);
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: string }>(
          `SELECT payload FROM activation_tickets WHERE namespace = $1 AND ticket_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS}`,
          parameters(id, generation));
        return parse<TicketRecord>(rows[0]);
      });
    },
    async take(id) {
      text(id);
      return run(async (client, generation) => {
        // pg locks flow-then-ticket first; the serialized writer makes that atomic.
        const { rows } = await client.query<{ payload: string }>(
          `DELETE FROM activation_tickets WHERE namespace = $1 AND ticket_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS} RETURNING payload`,
          parameters(id, generation));
        return parse<TicketRecord>(rows[0]);
      });
    },
    async remove(id) {
      text(id);
      await run(async (client, generation) => {
        await client.query('DELETE FROM activation_tickets WHERE namespace = $1 AND ticket_id = $2 AND generation = $3', parameters(id, generation));
      });
    },
  };
  const flows: BrowserFlowStore = {
    async put(value) {
      const payload: BrowserFlowRecord = { ...flowBinding(value), flowId: text(value.flowId),
        ticketId: text(value.ticketId), expiresAt: deadline(value.expiresAt) };
      await run(async (client, generation) => {
        const { rowCount } = await client.query(
          `INSERT INTO browser_flows (namespace, generation, payload, ticket_expires_ms)
           SELECT namespace, generation, $4, expires_ms FROM activation_tickets
           WHERE namespace = $1 AND ticket_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS} AND $5 > ${NOW_MS}`,
          [...parameters(payload.ticketId, generation), JSON.stringify(payload), payload.expiresAt]);
        if (rowCount !== 1) throw new Error('invalid activation ticket');
      });
    },
    async peek(id) {
      text(id);
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: string }>(
          `SELECT payload FROM browser_flows WHERE namespace = $1 AND flow_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS}`,
          parameters(id, generation));
        return parse<BrowserFlowRecord>(rows[0]);
      });
    },
    async remove(id) {
      text(id);
      await run(async (client, generation) => {
        await client.query('DELETE FROM browser_flows WHERE namespace = $1 AND flow_id = $2 AND generation = $3', parameters(id, generation));
      });
    },
  };
  return { tickets, flows };
}

/** No eager I/O or DDL. Hosts issue fresh random IDs with ttlSeconds <=60.
 * Use consume for browser activation; standalone TicketStore supports existing services.
 * Only an acknowledged consume result permits the host to sign/set a grant cookie.
 */
export function createSqliteActivationStore(options: {
  db: SqliteDatabase;
  writer: SqliteWriter;
  namespace: string;
}): SqliteActivationStore {
  const namespace = text(options.namespace);
  const { db, writer } = options;
  const run: Run = work => transaction(db, writer, namespace, work);
  return {
    ...recordStores(run, namespace),
    async consume(value: ActivationConsumeInput, authorize: ActivationAuthority) {
      // Snapshot before the writer is acquired; callers cannot retarget an in-flight consume.
      const flowId = text(value.flowId);
      const ticketId = text(value.ticketId);
      const expected = { ...value.expected };
      return run(async (client, generation) => {
        const flowResult = await client.query<{ payload: string }>(
          'SELECT payload FROM browser_flows WHERE namespace = $1 AND flow_id = $2 AND generation = $3',
          [namespace, flowId, generation]);
        const flow = parse<BrowserFlowRecord>(flowResult.rows[0]);
        if (!flow || flow.ticketId !== ticketId || flowKeys.some(key => flow[key] !== expected[key])) return undefined;
        const ticketResult = await client.query<{ payload: string }>(
          'SELECT payload FROM activation_tickets WHERE namespace = $1 AND ticket_id = $2 AND generation = $3',
          [namespace, ticketId, generation]);
        const ticket = parse<TicketRecord>(ticketResult.rows[0]);
        if (!ticket || bindingKeys.some(key => ticket[key] !== expected[key])) return undefined;
        // This read happens AFTER both lookups; authority may wait again (writer held).
        const live = await client.query(
          `SELECT 1 AS one FROM browser_flows WHERE namespace = $1 AND flow_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS}`,
          [namespace, flowId, generation]);
        if (live.rows.length === 0) return undefined;
        if (await authorize({ client: client as unknown as PoolClient, namespace,
          ticket: Object.freeze({ ...ticket }), flow: Object.freeze({ ...flow }) }) !== true) return undefined;
        // One visibility decision after ALL authority waits; cascade consumes the flow.
        const consumed = await client.query<{ payload: string }>(
          `DELETE FROM activation_tickets WHERE namespace = $1 AND ticket_id = $2 AND generation = $3 AND expires_ms > ${NOW_MS}
           AND EXISTS (
             SELECT 1 FROM browser_flows f WHERE f.namespace = activation_tickets.namespace
             AND f.ticket_id = activation_tickets.ticket_id AND f.flow_id = $4 AND f.generation = activation_tickets.generation AND f.expires_ms > ${NOW_MS})
           RETURNING payload`, [namespace, ticketId, generation, flowId]);
        return parse<TicketRecord>(consumed.rows[0]);
      });
    },
    async cleanup(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid activation cleanup limit');
      return run(async (client, generation) => {
        // No DELETE…LIMIT / FOR UPDATE SKIP LOCKED in SQLite: bounded IN-subselects
        // under the serialized writer, same row selection and total bound.
        const flows = await client.query(
          `DELETE FROM browser_flows WHERE namespace = $1 AND flow_id IN (
             SELECT flow_id FROM browser_flows WHERE namespace = $2
             AND (expires_ms <= ${NOW_MS} OR generation < $3) ORDER BY expires_ms, flow_id LIMIT $4)`,
          [namespace, namespace, generation, limit]);
        const flowCount = flows.rowCount;
        const tickets = await client.query(
          `DELETE FROM activation_tickets WHERE namespace = $1 AND ticket_id IN (
             SELECT ticket_id FROM activation_tickets t WHERE t.namespace = $2
             AND (t.expires_ms <= ${NOW_MS} OR t.generation < $3)
             AND NOT EXISTS (SELECT 1 FROM browser_flows f WHERE f.namespace = t.namespace AND f.ticket_id = t.ticket_id)
             ORDER BY t.expires_ms, t.ticket_id LIMIT $4)`,
          [namespace, namespace, generation, limit - flowCount]);
        return { flows: flowCount, tickets: tickets.rowCount };
      });
    },
    async invalidate() {
      // pg takes the namespace row FOR UPDATE; the serialized writer is already exclusive.
      await transaction(db, writer, namespace, async client => {
        await client.query('UPDATE activation_namespaces SET generation = generation + 1 WHERE namespace = $1', [namespace]);
      });
    },
  };
}
