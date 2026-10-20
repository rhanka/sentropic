// engram-memory Postgres registration and storage (binding section 2.3).
// Mirrors the Comments architectural pattern: fixed module identity,
// descriptor, effects validator, queries, limits and trusted operations,
// then delegation to `createPostgresKernel`. No connection acquisition or
// migration execution in registration. A host cannot override mandatory
// validation, recovery or ownership through the storage factory.

import { createPostgresKernel } from '../storage/postgres/index.js';
import type { PostgresStorageOptions } from '../storage/postgres/protocol.js';
import { loadPgAssets } from '../storage/postgres/migrations.js';
import { StorageInvalidCommandError } from '../storage/errors.js';
import type { AtomicUnit } from '../storage/atomic.js';
import { MEMORY_DESCRIPTOR } from './manifest.js';
import { MEMORY_PG_QUERIES } from './postgres-queries.js';
import { MEMORY_STORAGE_LIMITS, requireMemoryStorageLimits } from './limits.js';
import { isMemoryAdmissionOutcome, isMemoryCaptureProof } from './validation.js';

export interface MemoryPostgresRegistration {
  readonly assets: Awaited<ReturnType<typeof loadPgAssets>>;
  readonly descriptor: typeof MEMORY_DESCRIPTOR;
  readonly validateEffects: (effects: AtomicUnit, context: unknown) => Promise<void>;
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
 * Mandatory structural validation before projection: capture and admission
 * aggregates must carry well-formed proofs, and capture completion units
 * carry strictly zero appends. Stateful current-versus-proposed transition
 * checks run in the G1b transactional projection with backend reads.
 */
export const validateMemoryEffects = async (effects: AtomicUnit): Promise<void> => {
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
    } else if (kind === 'memory-admission-outcome-v1') {
      if (!isMemoryAdmissionOutcome(value)) {
        throw new StorageInvalidCommandError('memory admission update requires an admission outcome value');
      }
    }
  }
  if (touchesCapture && effects.appends.length !== 0) {
    throw new StorageInvalidCommandError('memory capture completion carries strictly zero appends');
  }
};

export const createMemoryPostgresRegistration = async (): Promise<MemoryPostgresRegistration> =>
  Object.freeze({
    assets: await loadPgAssets(),
    descriptor: MEMORY_DESCRIPTOR,
    validateEffects: async (effects: AtomicUnit) => {
      await validateMemoryEffects(effects);
    },
    queries: MEMORY_PG_QUERIES,
    limits: MEMORY_STORAGE_LIMITS,
  });

export const createMemoryPostgresStorage = async (
  options: Omit<
    PostgresStorageOptions,
    'moduleId' | 'assets' | 'descriptor' | 'projection' | 'validateEffects' | 'queries' | 'operations'
  >,
) => {
  const registration = await createMemoryPostgresRegistration();
  return createPostgresKernel({
    ...options,
    moduleId: 'engram-memory',
    assets: registration.assets,
    descriptor: registration.descriptor,
    validateEffects: registration.validateEffects,
    queries: registration.queries,
    operations: {},
    limits: requireMemoryStorageLimits(options.limits),
  });
};
