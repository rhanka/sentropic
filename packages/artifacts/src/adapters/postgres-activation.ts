import type { Pool, PoolClient } from 'pg';
import type { TicketBinding, TicketRecord, TicketStore } from '../content/grants.js';

export const ACTIVATION_MAX_TTL_SECONDS = 60;
export const ACTIVATION_SQL_ASSET = '@sentropic/artifacts/sql/0001_activation.sql';
export const ACTIVATION_SQL_ASSET_SHA256 = '13767c826a62aa5f880809ca2ebc60bdc638b2e59f983e195d4351356b282d8b';

export interface BrowserFlowBinding extends TicketBinding {
  nonceDigest: string;
  sessionId: string;
  profileDigest: string;
  policyRevision: string;
  targetOrigin: string;
}
export interface BrowserFlowRecord extends BrowserFlowBinding {
  flowId: string;
  ticketId: string;
  expiresAt: number;
}
export interface BrowserFlowStore {
  put(record: BrowserFlowRecord): Promise<void>;
  peek(flowId: string): Promise<BrowserFlowRecord | undefined>;
  remove(flowId: string): Promise<void>;
}
export interface ActivationConsumeInput {
  flowId: string;
  ticketId: string;
  expected: BrowserFlowBinding;
}
/** Host locks current session/ACL/release/policy on this client through COMMIT.
 * No cookies, signing or externally visible effects inside this callback.
 */
export type ActivationAuthority = (context: {
  client: PoolClient;
  namespace: string;
  ticket: Readonly<TicketRecord>;
  flow: Readonly<BrowserFlowRecord>;
}) => Promise<boolean>;
export interface PostgresActivationStore {
  tickets: TicketStore;
  flows: BrowserFlowStore;
  consume(input: ActivationConsumeInput, authorize: ActivationAuthority): Promise<TicketRecord | undefined>;
  /** Total deleted rows <= limit (1..1000), including no unbounded cascades. */
  cleanup(limit?: number): Promise<{ flows: number; tickets: number }>;
  /** Closed-serving restore step: invalidate all prior state in O(1). Rotate signing keys separately. */
  invalidate(): Promise<void>;
}
export class ActivationCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super('activation commit outcome unknown; start a fresh flow', { cause });
    this.name = 'ActivationCommitUnknownError';
  }
}

const bindingKeys = ['subjectId', 'artifactId', 'releaseId', 'channel'] as const;
const flowKeys = [...bindingKeys, 'nonceDigest', 'sessionId', 'profileDigest', 'policyRevision', 'targetOrigin'] as const;
const nowSql = 'floor(extract(epoch FROM clock_timestamp()) * 1000)';
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

async function transaction<T>(pool: Pool, namespace: string,
  work: (client: PoolClient, generation: string) => Promise<T>, exclusive = false): Promise<T> {
  const client = await pool.connect();
  let committing = false;
  let destroy = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('INSERT INTO artifact_host.activation_namespaces(namespace) VALUES ($1) ON CONFLICT DO NOTHING', [namespace]);
    const { rows } = await client.query<{ generation: string }>(
      `SELECT generation FROM artifact_host.activation_namespaces WHERE namespace=$1 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [namespace]);
    const result = await work(client, rows[0]!.generation);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    if (committing) {
      destroy = true;
      throw new ActivationCommitUnknownError(cause);
    }
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw cause;
  } finally { client.release(destroy); }
}

type Run = <T>(work: (client: PoolClient, generation: string) => Promise<T>) => Promise<T>;
function recordStores(run: Run, namespace: string): Pick<PostgresActivationStore, 'tickets' | 'flows'> {
  const parameters = (id: string, generation: string) => [namespace, text(id), generation];
  async function lockTicket(client: PoolClient, id: string, generation: string) {
    // Same lock order as consume: browser flow, then ticket (including cascades).
    await client.query('SELECT flow_id FROM artifact_host.browser_flows WHERE namespace=$1 AND ticket_id=$2 FOR UPDATE', [namespace, id]);
    await client.query('SELECT ticket_id FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 FOR UPDATE',
      parameters(id, generation));
  }
  const tickets: TicketStore = {
    async issue(value, ttlMs) {
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > ACTIVATION_MAX_TTL_SECONDS * 1000) {
        throw new Error('invalid activation lifetime');
      }
      const payload = { ...binding(value), ticketId: text(value.ticketId) };
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: TicketRecord }>(
          `WITH issued AS (SELECT ${nowSql}::bigint AS ms)
           INSERT INTO artifact_host.activation_tickets(namespace,generation,payload,issued_ms)
           SELECT $1,$2,jsonb_set($3::jsonb,'{expiresAt}',to_jsonb(ms+$4::bigint)),ms FROM issued
           RETURNING payload`, [namespace, generation, JSON.stringify(payload), ttlMs]);
        return rows[0]!.payload;
      });
    },
    async put(value) {
      const payload: TicketRecord = { ...binding(value), ticketId: text(value.ticketId), expiresAt: deadline(value.expiresAt) };
      await run(async (client, generation) => {
        await client.query('INSERT INTO artifact_host.activation_tickets(namespace,generation,payload) VALUES ($1,$2,$3)',
          [namespace, generation, JSON.stringify(payload)]);
      });
    },
    async peek(id) {
      text(id);
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: TicketRecord }>(
          `SELECT payload FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 AND expires_ms>${nowSql}`,
          parameters(id, generation));
        return rows[0]?.payload;
      });
    },
    async take(id) {
      text(id);
      return run(async (client, generation) => {
        await lockTicket(client, id, generation);
        const { rows } = await client.query<{ payload: TicketRecord }>(
          `DELETE FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 AND expires_ms>${nowSql} RETURNING payload`,
          parameters(id, generation));
        return rows[0]?.payload;
      });
    },
    async remove(id) {
      text(id);
      await run(async (client, generation) => {
        await lockTicket(client, id, generation);
        await client.query('DELETE FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3', parameters(id, generation));
      });
    },
  };
  const flows: BrowserFlowStore = {
    async put(value) {
      const payload: BrowserFlowRecord = { ...flowBinding(value), flowId: text(value.flowId),
        ticketId: text(value.ticketId), expiresAt: deadline(value.expiresAt) };
      await run(async (client, generation) => {
        await client.query('SELECT ticket_id FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 FOR UPDATE',
          parameters(payload.ticketId, generation));
        const { rowCount } = await client.query(
          `INSERT INTO artifact_host.browser_flows(namespace,generation,payload,ticket_expires_ms)
           SELECT namespace,generation,$4,expires_ms FROM artifact_host.activation_tickets
           WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 AND expires_ms>${nowSql} AND $5::bigint>${nowSql}`,
          [...parameters(payload.ticketId, generation), JSON.stringify(payload), payload.expiresAt]);
        if (rowCount !== 1) throw new Error('invalid activation ticket');
      });
    },
    async peek(id) {
      text(id);
      return run(async (client, generation) => {
        const { rows } = await client.query<{ payload: BrowserFlowRecord }>(
          `SELECT payload FROM artifact_host.browser_flows WHERE namespace=$1 AND flow_id=$2 AND generation=$3 AND expires_ms>${nowSql}`,
          parameters(id, generation));
        return rows[0]?.payload;
      });
    },
    async remove(id) {
      text(id);
      await run(async (client, generation) => {
        await client.query('DELETE FROM artifact_host.browser_flows WHERE namespace=$1 AND flow_id=$2 AND generation=$3', parameters(id, generation));
      });
    },
  };
  return { tickets, flows };
}

/** No eager I/O or DDL. Hosts issue fresh random IDs with ttlSeconds <=60.
 * Use consume for browser activation; standalone TicketStore supports existing services.
 * Only an acknowledged consume result permits the host to sign/set a grant cookie.
 */
export function createPostgresActivationStore(options: { pool: Pool; namespace: string }): PostgresActivationStore {
  const namespace = text(options.namespace);
  const pool = options.pool;
  const run: Run = work => transaction(pool, namespace, work);
  return {
    ...recordStores(run, namespace),
    async consume(value, authorize) {
      // Snapshot before acquisition waits; callers cannot retarget an in-flight consume.
      const flowId = text(value.flowId);
      const ticketId = text(value.ticketId);
      const expected = { ...value.expected };
      return run(async (client, generation) => {
        const params = [namespace, flowId, generation];
        const flowResult = await client.query<{ payload: BrowserFlowRecord }>(
          'SELECT payload FROM artifact_host.browser_flows WHERE namespace=$1 AND flow_id=$2 AND generation=$3 FOR UPDATE', params);
        const flow = flowResult.rows[0]?.payload;
        if (!flow || flow.ticketId !== ticketId || flowKeys.some(key => flow[key] !== expected[key])) return undefined;
        const ticketResult = await client.query<{ payload: TicketRecord }>(
          'SELECT payload FROM artifact_host.activation_tickets WHERE namespace=$1 AND ticket_id=$2 AND generation=$3 FOR UPDATE',
          [namespace, ticketId, generation]);
        const ticket = ticketResult.rows[0]?.payload;
        if (!ticket || bindingKeys.some(key => ticket[key] !== expected[key])) return undefined;
        // This read happens AFTER both row-lock waits; authority may wait again.
        const live = await client.query(`SELECT 1 FROM artifact_host.browser_flows
          WHERE namespace=$1 AND flow_id=$2 AND generation=$3 AND expires_ms>${nowSql}`, params);
        if (live.rows.length === 0) return undefined;
        if (await authorize({ client, namespace, ticket: Object.freeze({ ...ticket }), flow: Object.freeze({ ...flow }) }) !== true) return undefined;
        // One visibility decision after ALL authority waits; cascade consumes the flow.
        const consumed = await client.query<{ payload: TicketRecord }>(
          `DELETE FROM artifact_host.activation_tickets t WHERE t.namespace=$1 AND t.ticket_id=$2
           AND t.generation=$3 AND t.expires_ms>${nowSql} AND EXISTS (
             SELECT 1 FROM artifact_host.browser_flows f WHERE f.namespace=t.namespace
             AND f.ticket_id=t.ticket_id AND f.flow_id=$4 AND f.generation=t.generation AND f.expires_ms>${nowSql})
           RETURNING payload`, [namespace, ticketId, generation, flowId]);
        return consumed.rows[0]?.payload;
      });
    },
    async cleanup(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid activation cleanup limit');
      return run(async (client, generation) => {
        const flows = await client.query(`WITH due AS (
          SELECT flow_id FROM artifact_host.browser_flows WHERE namespace=$1
          AND (expires_ms<=${nowSql} OR generation<$2) ORDER BY expires_ms,flow_id
          LIMIT $3 FOR UPDATE SKIP LOCKED)
          DELETE FROM artifact_host.browser_flows f USING due WHERE f.namespace=$1 AND f.flow_id=due.flow_id`,
          [namespace, generation, limit]);
        const flowCount = flows.rowCount ?? 0;
        const tickets = await client.query(`WITH due AS (
          SELECT ticket_id FROM artifact_host.activation_tickets t WHERE namespace=$1
          AND (expires_ms<=${nowSql} OR generation<$2)
          AND NOT EXISTS (SELECT 1 FROM artifact_host.browser_flows f WHERE f.namespace=t.namespace AND f.ticket_id=t.ticket_id)
          ORDER BY expires_ms,ticket_id LIMIT $3 FOR UPDATE SKIP LOCKED)
          DELETE FROM artifact_host.activation_tickets t USING due WHERE t.namespace=$1 AND t.ticket_id=due.ticket_id`,
          [namespace, generation, limit - flowCount]);
        return { flows: flowCount, tickets: tickets.rowCount ?? 0 };
      });
    },
    async invalidate() {
      await transaction(pool, namespace, async client => {
        await client.query('UPDATE artifact_host.activation_namespaces SET generation=generation+1 WHERE namespace=$1', [namespace]);
      }, true);
    },
  };
}
