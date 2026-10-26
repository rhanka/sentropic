// PostgreSQL durable CanonicalInstanceOwnershipV1 (lot E4).
// Reuses the neutral contract name/version/meaning/digest, the handle shape
// and the CanonicalOwnershipError codes; adds no second ownership contract.
// Durability: one row per owning module in the 008 asset table. Epochs stay
// exact-u64 TEXT end to end (BigInt only, never Number); the single-row
// compare-and-swap makes supersede monotone and loss terminal.
import { randomUUID } from 'node:crypto';
import {
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  type CanonicalInstanceHandle,
} from '../instance-ownership.js';
import { isPositiveU64Counter, nextU64Counter } from '../u64.js';
import { decodePgText } from './codec.js';
import type { PgSession } from './protocol.js';

/** Stable store key: one live holder per data schema and owning module. */
export const resolvePgStoreKey = (dataSchema: string, moduleId: string): string =>
  JSON.stringify(['pg', dataSchema, moduleId]);

export interface PgInstanceOwnershipSession {
  readonly handle: CanonicalInstanceHandle;
  verify(session: PgSession): Promise<void>;
  release(): void;
}

interface DurablePair {
  instance: string;
  epoch: string;
}

const missingOwnershipTable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  return fields.code === '42P01' || fields.sqlState === '42P01';
};

const readPair = async (session: PgSession, schema: string, moduleId: string): Promise<DurablePair | null> => {
  let rows: readonly Record<string, unknown>[];
  try {
    const result = await session.execute({
      text: `SELECT instance, epoch FROM ${schema}.instance_ownership WHERE module=$1 FOR UPDATE`,
      values: [moduleId],
    });
    rows = result.rows;
  } catch (error) {
    if (missingOwnershipTable(error)) {
      throw new CanonicalOwnershipError('open-refused', 'instance ownership is not installed for this store');
    }
    throw error;
  }
  const row = rows[0];
  if (row === undefined) return null;
  try {
    const epoch = decodePgText(row.epoch);
    if (!isPositiveU64Counter(epoch)) {
      throw new CanonicalOwnershipError('open-refused', 'stored ownership epoch is out of domain');
    }
    return { instance: decodePgText(row.instance), epoch };
  } catch (error) {
    if (error instanceof CanonicalOwnershipError) throw error;
    throw new CanonicalOwnershipError('open-refused', 'stored ownership pair is unreadable');
  }
};

export const acquirePgInstanceOwnership = async (
  session: PgSession,
  schema: string,
  storeKey: string,
  moduleId: string,
  registry: CanonicalInstanceRegistry,
): Promise<PgInstanceOwnershipSession> => {
  const row = await readPair(session, schema, moduleId);
  let instance: string;
  let epoch: string;
  let persist: () => Promise<void>;
  if (row === null) {
    instance = `instance-${randomUUID()}`;
    epoch = '1';
    persist = async () => {
      await session.execute({
        text: `INSERT INTO ${schema}.instance_ownership(module, instance, epoch) VALUES($1, $2, $3)`,
        values: [moduleId, instance, epoch],
      });
    };
  } else {
    const next = nextU64Counter(row.epoch);
    if (next === undefined) {
      throw new CanonicalOwnershipError('stale-epoch', `epoch allocation exhausted at ${row.epoch}`);
    }
    instance = row.instance;
    epoch = next;
    persist = async () => {
      const moved = await session.execute({
        text: `UPDATE ${schema}.instance_ownership SET epoch=$1 WHERE module=$2 AND epoch=$3`,
        values: [next, moduleId, row.epoch],
      });
      if (moved.rowCount !== 1) {
        throw new CanonicalOwnershipError('instance-busy', `concurrent open won the store ${storeKey}`);
      }
    };
  }
  // The shared registry refuses a second live holder of this process
  // promptly (no queue) before anything durable moves; a fresh registry lets
  // the durable row arbitrate across processes through monotone supersede.
  const registryHandle = registry.acquire(storeKey, epoch);
  try {
    await persist();
  } catch (error) {
    registry.release(registryHandle);
    throw error;
  }
  const handle: CanonicalInstanceHandle = Object.freeze({ instanceId: instance, storageEpoch: epoch, storeKey });
  return {
    handle,
    verify: async (verifySession: PgSession) => {
      await verifyPgInstanceOwnership(verifySession, schema, moduleId, handle);
    },
    release: () => {
      registry.release(registryHandle);
    },
  };
};

export const verifyPgInstanceOwnership = async (
  session: PgSession,
  schema: string,
  moduleId: string,
  handle: CanonicalInstanceHandle,
): Promise<void> => {
  const result = await session.execute({
    text: `SELECT instance, epoch FROM ${schema}.instance_ownership WHERE module=$1`,
    values: [moduleId],
  });
  const row = result.rows[0];
  if (row === undefined) throw new CanonicalOwnershipError('terminal-loss', 'ownership row is gone');
  let instance: string;
  let epoch: string;
  try {
    instance = decodePgText(row.instance);
    epoch = decodePgText(row.epoch);
  } catch {
    throw new CanonicalOwnershipError('terminal-loss', 'stored ownership pair is unreadable');
  }
  if (instance !== handle.instanceId || !isPositiveU64Counter(epoch) || epoch !== handle.storageEpoch) {
    throw new CanonicalOwnershipError('terminal-loss', 'ownership moved to another instance or epoch');
  }
};
