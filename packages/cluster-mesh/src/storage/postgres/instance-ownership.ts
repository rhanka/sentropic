// PostgreSQL durable CanonicalInstanceOwnershipV1 (lot E4, R1).
// Reuses the neutral contract name/version/meaning/digest, the handle shape
// and the CanonicalOwnershipError codes; adds no second ownership contract.
// Design (see BRANCH.md Feedback Loop): a retained lease row per owning
// module. The holder keeps holder_until live by renewal; a second opener is
// refused promptly (instance-busy, no queue, no supersede). Code mapping
// follows the neutral registry exactly: superseded/released/unknown holder
// is stale-epoch; only explicit terminal state or a dead unclaimed lease is
// terminal-loss; live second openers are instance-busy; open-time refusals
// are open-refused. PG surfaces these unwrapped (classifyPgFailure passes
// CanonicalOwnershipError through, like SQLite throwing it directly).
import { randomUUID } from 'node:crypto';
import {
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  type CanonicalInstanceHandle,
} from '../instance-ownership.js';
import { isPositiveU64Counter, nextU64Counter } from '../u64.js';
import { PostgresStorageError } from './errors.js';
import { decodePgText } from './codec.js';
import type { PgSession } from './protocol.js';

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/** Stable store key: one live holder per data schema and owning module. */
export const resolvePgStoreKey = (dataSchema: string, moduleId: string): string =>
  JSON.stringify(['pg', dataSchema, moduleId]);

export interface PgInstanceOwnershipSession {
  readonly handle: CanonicalInstanceHandle;
  verify(session: PgSession): Promise<void>;
  release(): Promise<void>;
}

interface DurablePair {
  instance: string;
  epoch: string;
  holderUntilMs: number;
  nowMs: number;
}

const missingOwnershipTable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  return fields.code === '42P01' || fields.sqlState === '42P01';
};

const acquisitionRaced = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  const state = fields.sqlState ?? fields.code;
  return state === '55P03' || state === '40001' || state === '40P01';
};

const decodeLeaseMs = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  throw new PostgresStorageError('corruption');
};

const readPair = async (session: PgSession, schema: string, moduleId: string, lock: boolean): Promise<DurablePair | null> => {
  let result;
  try {
    result = await session.execute({
      text: `SELECT instance, epoch, holder_until, clock_timestamp() AS now FROM ${schema}.instance_ownership WHERE module=$1${lock ? ' FOR UPDATE' : ''}`,
      values: [moduleId],
    });
  } catch (error) {
    if (missingOwnershipTable(error)) {
      throw new CanonicalOwnershipError('open-refused', 'instance ownership is not installed for this store');
    }
    if (lock && acquisitionRaced(error)) {
      throw new CanonicalOwnershipError('instance-busy', 'concurrent acquisition in progress');
    }
    throw error;
  }
  const row = result.rows[0];
  if (row === undefined) return null;
  try {
    const epoch = decodePgText(row.epoch);
    if (!isPositiveU64Counter(epoch)) {
      throw new CanonicalOwnershipError('open-refused', 'stored ownership epoch is out of domain');
    }
    return {
      instance: decodePgText(row.instance),
      epoch,
      holderUntilMs: decodeLeaseMs(row.holder_until),
      nowMs: decodeLeaseMs(row.now),
    };
  } catch (error) {
    if (error instanceof CanonicalOwnershipError) throw error;
    throw new CanonicalOwnershipError('open-refused', 'stored ownership pair is unreadable');
  }
};

const leaseParams = (leaseMs: number): number => leaseMs / 1000;

export const acquirePgInstanceOwnership = async (
  session: PgSession,
  schema: string,
  storeKey: string,
  moduleId: string,
  registry: CanonicalInstanceRegistry,
  leaseMs: number,
): Promise<{ handle: CanonicalInstanceHandle; registryHandle: CanonicalInstanceHandle }> => {
  // The durable claim runs first; a registry refusal afterwards rolls the
  // open transaction back, so a busy holder never leaves a moved epoch
  // behind. A shared registry refuses a second live holder of this process
  // promptly (no queue); a fresh registry lets the lease row arbitrate
  // across processes through refusal (never supersede).
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await readPair(session, schema, moduleId, true);
    if (row !== null && row.holderUntilMs > row.nowMs) {
      throw new CanonicalOwnershipError('instance-busy', `live holder retained for ${storeKey}`);
    }
    const epoch = row === null ? '1' : nextU64Counter(row.epoch);
    if (epoch === undefined) {
      throw new CanonicalOwnershipError('stale-epoch', `epoch allocation exhausted at ${row?.epoch}`);
    }
    const instance = row === null ? `instance-${randomUUID()}` : row.instance;
    const claimed = await session.execute({
      text: row === null
        ? `INSERT INTO ${schema}.instance_ownership(module, instance, epoch, holder_until) VALUES($1, $2, $3, clock_timestamp() + make_interval(secs => $4)) ON CONFLICT(module) DO NOTHING`
        : `UPDATE ${schema}.instance_ownership SET instance=$2, epoch=$3, holder_until = clock_timestamp() + make_interval(secs => $4) WHERE module=$1`,
      values: [moduleId, instance, epoch, leaseParams(leaseMs)],
    }).catch((error: unknown) => {
      if (acquisitionRaced(error)) {
        throw new CanonicalOwnershipError('instance-busy', 'concurrent acquisition in progress');
      }
      throw error;
    });
    if (row === null && claimed.rowCount === 0) continue;
    if (row !== null && claimed.rowCount !== 1) {
      throw new CanonicalOwnershipError('instance-busy', `concurrent open won the store ${storeKey}`);
    }
    const registryHandle = registry.acquire(storeKey, epoch);
    const handle: CanonicalInstanceHandle = Object.freeze({ instanceId: instance, storageEpoch: epoch, storeKey });
    return { handle, registryHandle };
  }
  throw new CanonicalOwnershipError('instance-busy', `concurrent acquisition in progress for ${storeKey}`);
};

export const verifyPgInstanceOwnership = async (
  session: PgSession,
  schema: string,
  moduleId: string,
  handle: CanonicalInstanceHandle,
  released: boolean,
): Promise<void> => {
  if (released) throw new CanonicalOwnershipError('stale-epoch', 'ownership handle was released');
  const row = await readPair(session, schema, moduleId, false);
  if (row === null) throw new CanonicalOwnershipError('terminal-loss', 'ownership row is gone');
  if (row.instance !== handle.instanceId) throw new CanonicalOwnershipError('terminal-loss', 'ownership moved to another instance');
  if (row.epoch !== handle.storageEpoch) {
    if (row.holderUntilMs > row.nowMs) throw new CanonicalOwnershipError('stale-epoch', 'ownership superseded by a live successor');
    throw new CanonicalOwnershipError('terminal-loss', 'ownership moved to a newer epoch');
  }
  if (row.holderUntilMs <= row.nowMs) throw new CanonicalOwnershipError('terminal-loss', 'retained session expired');
};

export const renewPgInstanceLease = async (
  session: PgSession,
  schema: string,
  moduleId: string,
  handle: CanonicalInstanceHandle,
  released: boolean,
  leaseMs: number,
): Promise<void> => {
  await verifyPgInstanceOwnership(session, schema, moduleId, handle, released);
  const moved = await session.execute({
    text: `UPDATE ${schema}.instance_ownership SET holder_until = clock_timestamp() + make_interval(secs => $4) WHERE module=$1 AND instance=$2 AND epoch=$3`,
    values: [moduleId, handle.instanceId, handle.storageEpoch, leaseParams(leaseMs)],
  });
  if (moved.rowCount !== 1) {
    throw new CanonicalOwnershipError('terminal-loss', 'ownership lost during renewal');
  }
};

// Release expires the lease without tripping the deferred UPDATE trigger:
// the row is replaced (same instance and epoch, dead lease) so a prompt
// takeover keeps instance continuity. Idempotent: a taken-over row is left
// alone.
export const expirePgInstanceLease = async (
  session: PgSession,
  schema: string,
  moduleId: string,
  handle: CanonicalInstanceHandle,
): Promise<void> => {
  const removed = await session.execute({
    text: `DELETE FROM ${schema}.instance_ownership WHERE module=$1 AND instance=$2 AND epoch=$3`,
    values: [moduleId, handle.instanceId, handle.storageEpoch],
  });
  if (removed.rowCount !== 1) return;
  await session.execute({
    text: `INSERT INTO ${schema}.instance_ownership(module, instance, epoch, holder_until) VALUES($1, $2, $3, clock_timestamp()) ON CONFLICT(module) DO NOTHING`,
    values: [moduleId, handle.instanceId, handle.storageEpoch],
  });
};
