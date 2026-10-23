// engram-memory SQLite registration and storage: explicit host driver
// injection (owner decision 2026-10-20). The host composition imports the
// public cluster-mesh SQLite backend/provider and passes it explicitly;
// Engram receives the neutral binding only, never a driver, raw SQL
// connection or cluster-mesh import. Wiring to the installed generic
// provider seam lands in G1d; until then construction refuses with typed
// errors instead of selecting a fallback or an implicit driver.

import { StorageUnavailableError } from '../storage/errors.js';
import type { SqliteOpenOptions } from '../storage/sqlite/engine.js';
import { MEMORY_DESCRIPTOR, MEMORY_REQUIRED_PROFILES } from './manifest.js';
import { MEMORY_SQLITE_QUERIES } from './sqlite-queries.js';
import { MEMORY_STORAGE_LIMITS } from './limits.js';

/** Typed refusal when no host driver is injected. Mirrors Engram's host-driver guard. */
export class MemoryHostDriverRequiredError extends Error {
  readonly code = 'HOST_DRIVER_REQUIRED' as const;
  constructor(message = 'Memory SQLite storage requires an explicit host-injected driver provider') {
    super(message);
    this.name = 'MemoryHostDriverRequiredError';
  }
}

export interface MemorySqliteDriverIdentity {
  readonly name: string;
  readonly version: string;
  readonly artifactDigest: string;
}

/**
 * Qualified backend-owned provider, with its installed artifact identity
 * and open/close lifecycle. The provider opens through the generic SQLite
 * engine's existing isolated owner process; it never injects an arbitrary
 * caller-owned handle, transfers a live connection across processes, loads
 * host callbacks into the owner, or overrides memory identity, ownership
 * checks or mandatory policy.
 */
export interface MemorySqliteDriverProvider {
  readonly identity: MemorySqliteDriverIdentity;
  readonly engineFloor: string;
}

export interface MemorySqliteProfileStatus {
  readonly profile: string;
  readonly status: 'pending-qualification';
}

export interface MemorySqliteQualification {
  readonly engineFloor: string;
  readonly journalMode: 'WAL';
  readonly synchronous: 'FULL';
  readonly lockingMode: 'EXCLUSIVE';
  readonly isolation: 'process';
  readonly requiredProfiles: readonly MemorySqliteProfileStatus[];
}

/** Pinned engine floor; kept literal so this leaf loads no backend. Tests pin it to the engine constant. */
export const MEMORY_SQLITE_ENGINE_FLOOR = '3.51.3' as const;

export const MEMORY_SQLITE_QUALIFICATION: MemorySqliteQualification = Object.freeze({
  engineFloor: MEMORY_SQLITE_ENGINE_FLOOR,
  journalMode: 'WAL',
  synchronous: 'FULL',
  lockingMode: 'EXCLUSIVE',
  isolation: 'process',
  requiredProfiles: Object.freeze(
    MEMORY_REQUIRED_PROFILES.map((profile) => Object.freeze({ profile, status: 'pending-qualification' as const })),
  ),
});

export interface MemorySqliteRegistration {
  readonly descriptor: typeof MEMORY_DESCRIPTOR;
  readonly qualification: typeof MEMORY_SQLITE_QUALIFICATION;
  readonly queries: typeof MEMORY_SQLITE_QUERIES;
  readonly limits: typeof MEMORY_STORAGE_LIMITS;
}

export const createMemorySqliteRegistration = async (): Promise<MemorySqliteRegistration> =>
  Object.freeze({
    descriptor: MEMORY_DESCRIPTOR,
    qualification: MEMORY_SQLITE_QUALIFICATION,
    queries: MEMORY_SQLITE_QUERIES,
    limits: MEMORY_STORAGE_LIMITS,
  });

export interface MemorySqliteStorageOptions {
  readonly path: string;
  readonly open?: Omit<SqliteOpenOptions, 'path'>;
  readonly driver: MemorySqliteDriverProvider;
}

const HEX64 = /^[a-f0-9]{64}$/;

const parseEngine = (version: string): [number, number, number] => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new StorageUnavailableError(`unreadable memory driver engine version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const engineAtLeast = (version: string, floor: string): boolean => {
  const [a, b, c] = parseEngine(version);
  const [x, y, z] = parseEngine(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
};

export const checkMemorySqliteDriver = (driver: unknown): MemorySqliteDriverProvider => {
  if (typeof driver !== 'object' || driver === null) {
    throw new MemoryHostDriverRequiredError();
  }
  const candidate = (driver as { readonly identity?: unknown; readonly engineFloor?: unknown }).identity;
  const floor = (driver as { readonly engineFloor?: unknown }).engineFloor;
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
  if (typeof floor !== 'string' || !engineAtLeast(floor, MEMORY_SQLITE_ENGINE_FLOOR)) {
    throw new StorageUnavailableError('memory driver engine is below the qualified floor');
  }
  return driver as MemorySqliteDriverProvider;
};

/**
 * SQLite storage assembly. Validates the explicit host provider, then
 * refuses: the G1d wiring to the installed generic provider seam and the
 * S-gated durable profiles (boundaries, outbox, fencing) are unavailable
 * in this increment. Failed construction acquires nothing and selects no
 * fallback.
 */
export const createMemorySqliteStorage = async (options: MemorySqliteStorageOptions): Promise<never> => {
  checkMemorySqliteDriver(options?.driver);
  if (typeof options?.path !== 'string' || options.path.length === 0) {
    throw new MemoryHostDriverRequiredError('memory SQLite storage requires a store path');
  }
  throw new StorageUnavailableError(
    'memory SQLite composition requires the G1d provider seam and qualified durable profiles',
  );
};
