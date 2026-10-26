import type { Pool, PoolClient } from 'pg';
import type { TicketBinding, TicketRecord, TicketStore } from '../content/grants.js';

export const ACTIVATION_MAX_TTL_SECONDS = 60;
export const ACTIVATION_SQL_ASSET = '@sentropic/artifacts/sql/0001_activation.sql';

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
