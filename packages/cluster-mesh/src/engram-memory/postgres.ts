// engram-memory Postgres registration and storage (binding section 2.3).
// Mirrors the Comments architectural pattern: fixed module identity,
// descriptor, effects validator, queries, limits and trusted operations,
// then delegation to `createPostgresKernel`. No connection acquisition or
// migration execution in registration. A host cannot override mandatory
// validation, recovery or ownership through the storage factory.

import type { PostgresStorageOptions } from '../storage/postgres/protocol.js';
import { loadPgAssets } from '../storage/postgres/migrations.js';
import { StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
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
  let touchesCapture = false;
  for (const update of effects.updates) {
    const kind = updateKind(update.key);
    if (kind === null) throw new StorageInvalidCommandError('memory aggregate update requires a compound key');
    const value = decodeUpdateValue(update.value);
    if (kind === 'memory-capture-idempotency-v1') {
      touchesCapture = true;
      if (!isMemoryCaptureProof(value)) {
        throw new StorageInvalidCommandError('memory capture update requires a capture proof value');
      }
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
  if (touchesCapture && effects.appends.length !== 0) {
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

/**
 * Postgres storage composition. FAILS CLOSED in this increment: the public
 * raw factory installed no G1b stateful projection, so admitting any write
 * lane would let a higher-version update replace a frozen first proof
 * (the generic kernel accepts higher aggregate versions). The K7/K8
 * transition core is enforced through `validateMemoryEffects` with a
 * current-state resolver; the factory itself refuses until G1b wires a
 * backend-backed resolver and transactional projection.
 */
export const createMemoryPostgresStorage = async (
  options: Omit<
    PostgresStorageOptions,
    'moduleId' | 'assets' | 'descriptor' | 'projection' | 'validateEffects' | 'queries' | 'operations'
  >,
): Promise<never> => {
  void options;
  throw new StorageUnavailableError(
    'memory Postgres composition requires the G1b stateful projection with backend reads',
  );
};
