// engram-memory work limits: fixed trusted policy for the memory module.
// Single-event units carry at most one append and eight records within one
// encoded megabyte; capture completion is one append, one record and 64 KiB
// with zero actual appends; maintenance defaults are 100 appends and
// 200 records within an explicitly pinned byte ceiling. Oversized imports
// refuse before effect; no staged import and no unbounded conversion.

import { UnsupportedProfileError } from '../storage/errors.js';
import type { WorkLimits } from '../storage/contracts.js';

/** Single-event unit ceilings (binding section 4, Engram registry completion). */
export const MEMORY_SINGLE_EVENT_LIMITS: WorkLimits = Object.freeze({
  maxRecords: 8,
  maxAppends: 1,
  maxEncodedBytes: 1048576,
});

/** Capture-completion ceilings: actual appends stay strictly zero. */
export const MEMORY_CAPTURE_COMPLETION_LIMITS: WorkLimits = Object.freeze({
  maxRecords: 1,
  maxAppends: 1,
  maxEncodedBytes: 65536,
});

/** Maintenance default ceilings with an explicitly pinned byte bound. */
export const MEMORY_MAINTENANCE_LIMITS: WorkLimits = Object.freeze({
  maxRecords: 200,
  maxAppends: 100,
  maxEncodedBytes: 1048576,
});

/** Finite backend import ceiling: one atomic empty-store operation. */
export const MEMORY_IMPORT_LIMITS: WorkLimits = Object.freeze({
  maxRecords: 200,
  maxAppends: 100,
  maxEncodedBytes: 1048576,
});

/** Installed storage policy: the maintenance ceilings bound every commit. */
export const MEMORY_STORAGE_LIMITS: WorkLimits = MEMORY_MAINTENANCE_LIMITS;

const atLeast = (limits: WorkLimits, floor: WorkLimits): boolean =>
  limits.maxRecords >= floor.maxRecords &&
  limits.maxAppends >= floor.maxAppends &&
  limits.maxEncodedBytes >= floor.maxEncodedBytes;

/**
 * A host cannot lower the memory ceilings below the installed policy:
 * weaker limits would admit executions the qualified tuple never covered.
 */
export const requireMemoryStorageLimits = (limits: WorkLimits = MEMORY_STORAGE_LIMITS): WorkLimits => {
  if (!atLeast(limits, MEMORY_STORAGE_LIMITS)) {
    throw new UnsupportedProfileError('memory-transport-capacity-v1');
  }
  return limits;
};
