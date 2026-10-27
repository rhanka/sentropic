// engram-memory Postgres registration and storage (binding section 2.3).
// Mirrors the Comments architectural pattern: fixed module identity,
// descriptor, effects validator, queries, limits and trusted operations,
// then delegation to `createPostgresKernel`. No connection acquisition or
// migration execution in registration. A host cannot override mandatory
// validation, recovery or ownership through the storage factory.

import type { InjectedPgDriver, PostgresStorageOptions } from '../storage/postgres/protocol.js';
import { createPostgresKernel } from '../storage/postgres/index.js';
import { loadPgAssets } from '../storage/postgres/migrations.js';
import { decodePgText } from '../storage/postgres/codec.js';
import { StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
import { MemoryHostDriverRequiredError } from './sqlite.js';
import type { AtomicUnit } from '../storage/atomic.js';
import { MEMORY_DESCRIPTOR } from './manifest.js';
import { MEMORY_PG_QUERIES } from './postgres-queries.js';
import { MEMORY_STORAGE_LIMITS } from './limits.js';
import { projectMemoryPgEffects, validateMemoryPgEffects } from './projection.js';
import type { PgRegisteredProjection } from '../storage/postgres/protocol.js';
import {
  isMemoryAdmissionOutcome,
  isMemoryCaptureProof,
  validateAdmissionTransition,
  validateCaptureTransition,
} from './validation.js';

export interface MemoryPostgresRegistration {
  readonly assets: Awaited<ReturnType<typeof loadPgAssets>>;
  readonly descriptor: typeof MEMORY_DESCRIPTOR;
  readonly validateEffects: PgRegisteredProjection;
  readonly projection: PgRegisteredProjection;
  readonly queries: typeof MEMORY_PG_QUERIES;
  readonly limits: typeof MEMORY_STORAGE_LIMITS;
}

const decodeUpdateValue = (value: unknown): unknown => {
  const candidate = value as { readonly format?: unknown; readonly data?: unknown };
  const text =
    candidate.format === 'base64' && typeof candidate.data === 'string'
      ? Buffer.from(candidate.data, 'base64').toString('utf8')
      : candidate.data;
  if (typeof text !== 'string') throw new StorageInvalidCommandError('memory aggregate update requires an encoded value');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StorageInvalidCommandError('memory aggregate update requires JSON bytes');
  }
};

const updateKind = (key: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? (parsed[0] as string) : null;
  } catch {
    return null;
  }
};

/**
 * Current-state reader for stateful enforcement: returns the decoded
 * aggregate value already stored under the key, or undefined when absent.
 * The G1b transactional projection will supply a backend-backed reader;
 * tests and offline composition supply their own.
 */
export type MemoryCurrentStateResolver = (key: string) => Promise<unknown>;

/** Stored aggregate envelope as returned by kernel aggregate reads. */
export interface MemoryStoredAggregate {
  readonly value: { readonly format: 'utf8' | 'base64'; readonly data: string };
}

/**
 * Build a current-state resolver from a kernel-style aggregate reader.
 * Stored bytes decode through the same envelope path as proposed updates,
 * so transition validators compare identical representations. G1b will
 * supply the backend-backed reader from its transactional projection.
 */
export const resolveMemoryCurrentFromAggregates = (
  readAggregate: (key: string) => Promise<MemoryStoredAggregate | null>,
): MemoryCurrentStateResolver => async (key: string): Promise<unknown> => {
  const found = await readAggregate(key);
  if (found === null || found === undefined) return undefined;
  return decodeUpdateValue(found.value);
};

/**
 * Mandatory structural validation before projection: capture and admission
 * aggregates must carry well-formed proofs, and capture completion units
 * carry strictly zero appends. When a current-state resolver is supplied,
 * K7 capture and K8 admission transitions are enforced statefully: a
 * higher-version write that changes the original proof or outcome is
 * refused before effects, and identical replay passes through.
 */
export const validateMemoryEffects = async (
  effects: AtomicUnit,
  resolveCurrent?: MemoryCurrentStateResolver,
): Promise<void> => {
  let completesCapture = false;
  for (const update of effects.updates) {
    const kind = updateKind(update.key);
    if (kind === null) throw new StorageInvalidCommandError('memory aggregate update requires a compound key');
    const value = decodeUpdateValue(update.value);
    if (kind === 'memory-capture-idempotency-v1') {
      if (!isMemoryCaptureProof(value)) {
        throw new StorageInvalidCommandError('memory capture update requires a capture proof value');
      }
      completesCapture ||= value.revision !== 1;
      if (resolveCurrent !== undefined) {
        const current = await resolveCurrent(update.key);
        const transition = validateCaptureTransition(current ?? null, value);
        if (!transition.ok) {
          throw new StorageInvalidCommandError(
            `memory capture first proof is immutable: ${transition.errors.join('; ')}`,
          );
        }
      }
    } else if (kind === 'memory-admission-outcome-v1') {
      if (!isMemoryAdmissionOutcome(value)) {
        throw new StorageInvalidCommandError('memory admission update requires an admission outcome value');
      }
      if (resolveCurrent !== undefined) {
        const current = await resolveCurrent(update.key);
        const transition = validateAdmissionTransition(current ?? null, value);
        if (!transition.ok) {
          throw new StorageInvalidCommandError(
            `memory admission first proof is immutable: ${transition.errors.join('; ')}`,
          );
        }
      }
    }
  }
  if (completesCapture && effects.appends.length !== 0) {
    throw new StorageInvalidCommandError('memory capture completion carries strictly zero appends');
  }
};

export const createMemoryPostgresRegistration = async (): Promise<MemoryPostgresRegistration> =>
  Object.freeze({
    assets: await loadPgAssets({ memory: true }),
    descriptor: MEMORY_DESCRIPTOR,
    validateEffects: validateMemoryPgEffects,
    projection: projectMemoryPgEffects,
    queries: MEMORY_PG_QUERIES,
    limits: MEMORY_STORAGE_LIMITS,
  });

/** Host-owned PG driver identity: named versioned artifact, hex digest. */
export interface MemoryPostgresDriverIdentity {
  readonly name: string;
  readonly version: string;
  readonly artifactDigest: string;
}

/**
 * Qualified host-owned PG driver/pool provider. The host composition owns
 * the pool lifecycle and passes the provider explicitly — including the
 * live pool, so installed calls run through the exact pool the provider
 * describes. Engram receives the neutral binding only, never the pool,
 * raw SQL access or this provider.
 */
export interface MemoryPostgresDriverProvider {
  readonly identity: MemoryPostgresDriverIdentity;
  readonly serverFloor: string;
  readonly pool: InjectedPgDriver;
}

/** Pinned server floor (the qualification stack runs postgres:17); kept literal. */
export const MEMORY_PG_SERVER_FLOOR = '17.0.0' as const;

const HEX64 = /^[a-f0-9]{64}$/;

const parseServer = (version: string): [number, number, number] => {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
  if (!match) throw new StorageUnavailableError(`unreadable memory PG server version: ${version}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
};

const serverAtLeast = (version: string, floor: string): boolean => {
  const [a, b, c] = parseServer(version);
  const [x, y, z] = parseServer(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
};

/** Object-level provider check: explicit host provider with a qualified identity, floor and live pool. */
export const checkMemoryPostgresDriver = (driver: unknown): MemoryPostgresDriverProvider => {
  if (typeof driver !== 'object' || driver === null) {
    throw new MemoryHostDriverRequiredError(
      'memory Postgres storage requires an explicit host-injected driver provider',
    );
  }
  const pool = (driver as { readonly pool?: unknown }).pool;
  if (
    typeof pool !== 'object' ||
    pool === null ||
    typeof (pool as { readonly transaction?: unknown }).transaction !== 'function'
  ) {
    throw new MemoryHostDriverRequiredError('memory driver provider requires the live host pool');
  }
  const candidate = (driver as { readonly identity?: unknown }).identity;
  const floor = (driver as { readonly serverFloor?: unknown }).serverFloor;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as Record<string, unknown>)['name'] !== 'string' ||
    ((candidate as Record<string, unknown>)['name'] as string).length === 0 ||
    typeof (candidate as Record<string, unknown>)['version'] !== 'string' ||
    ((candidate as Record<string, unknown>)['version'] as string).length === 0 ||
    typeof (candidate as Record<string, unknown>)['artifactDigest'] !== 'string' ||
    !HEX64.test((candidate as Record<string, unknown>)['artifactDigest'] as string)
  ) {
    throw new MemoryHostDriverRequiredError('memory driver provider requires a named versioned artifact identity');
  }
  if (typeof floor !== 'string' || !serverAtLeast(floor, MEMORY_PG_SERVER_FLOOR)) {
    throw new StorageUnavailableError('memory PG server is below the qualified floor');
  }
  return driver as MemoryPostgresDriverProvider;
};

/**
 * Live provider verification: run `SHOW server_version` through the
 * provider's own pool and require it to meet the declared floor. This
 * proves the pool is the installed one, not a metadata-only record.
 */
export const verifyMemoryPostgresProvider = async (
  driver: unknown,
): Promise<MemoryPostgresDriverProvider> => {
  const provider = checkMemoryPostgresDriver(driver);
  const version = await provider.pool.transaction(
    { isolation: 'serializable', readOnly: true, deadlineMs: 5000 },
    (session) =>
      session.execute({ text: 'SHOW server_version', values: [] }).then((result) => {
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return decodePgText(row?.['server_version']);
      }),
  );
  if (!serverAtLeast(version, provider.serverFloor)) {
    throw new StorageUnavailableError('memory PG server is below the provider floor');
  }
  return provider;
};

/**
 * Postgres storage composition, opened from the checked host provider
 * (r2 P1-B). The factory checks the provider (identity, floor, live pool),
 * fills the E6 stateful pieces (module assets, descriptor, effects
 * validation, projection, queries, limits) from the memory registration and
 * opens the kernel on the provider's own pool: installed calls run through
 * the exact pool the provider describes, never a separately wired driver.
 * The host applies migrations (E2 owns the migration writer); without the
 * provider no backend is reachable and the factory refuses with
 * `unavailable`. Engram never calls this factory: it receives the neutral
 * grant only.
 */
export const createMemoryPostgresStorage = async (
  options: Omit<
    PostgresStorageOptions,
    | 'moduleId'
    | 'driver'
    | 'assets'
    | 'descriptor'
    | 'projection'
    | 'validateEffects'
    | 'queries'
    | 'operations'
    | 'limits'
  > & {
    readonly provider: MemoryPostgresDriverProvider;
  },
): Promise<Awaited<ReturnType<typeof createPostgresKernel>>> => {
  const { provider, ...rest } = (options ?? {}) as Partial<PostgresStorageOptions> & {
    readonly provider?: unknown;
  };
  if (typeof provider !== 'object' || provider === null) {
    throw new StorageUnavailableError(
      'memory Postgres composition requires the checked host provider for the G1b stateful projection: no backend reachable',
    );
  }
  const checked = checkMemoryPostgresDriver(provider);
  const registration = await createMemoryPostgresRegistration();
  return createPostgresKernel({
    ...registration,
    ...rest,
    moduleId: 'engram-memory',
    driver: checked.pool,
  });
};
