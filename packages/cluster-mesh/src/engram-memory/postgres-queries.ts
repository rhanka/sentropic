// engram-memory Postgres named queries (binding section 4.1): input
// validation and scope checks for the five registered queries. Query
// execution against the memory projection tables lands in G1b with the
// append-only memory migration chain; until then every validated query
// refuses with a typed unavailable error instead of touching another
// module's tables.

import { StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
import type { PgRegisteredQuery, PgQueryPage } from '../storage/postgres/protocol.js';
import { MEMORY_QUERY_NAMES } from './manifest.js';
import { isCanonicalU64 } from './codec.js';

export type MemoryQueryName = (typeof MEMORY_QUERY_NAMES)[number];

export const isMemoryQueryName = (value: unknown): value is MemoryQueryName =>
  typeof value === 'string' && (MEMORY_QUERY_NAMES as readonly string[]).includes(value);

/** Strict page input: ascending cursor, 1–2,000 rows, under the byte ceiling. */
export const validateMemoryPageInput = (input: unknown, maxRecords: number): { readonly after: string; readonly limit: number } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory page query requires an object input');
  }
  const candidate = input as Record<string, unknown>;
  const after: unknown = candidate['after'];
  if (!isCanonicalU64(after)) {
    throw new StorageInvalidCommandError('memory page query requires a canonical u64 after cursor');
  }
  const limit: unknown = candidate['limit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maxRecords) {
    throw new StorageInvalidCommandError(`memory page query limit must be within 1 and ${maxRecords}`);
  }
  return { after, limit };
};

export const validateMemoryRecordByIdInput = (input: unknown): { readonly recordId: string } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory record query requires an object input');
  }
  const recordId: unknown = (input as Record<string, unknown>)['record_id'];
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new StorageInvalidCommandError('memory record query requires a record_id');
  }
  return { recordId };
};

export const validateMemorySnapshotInput = (
  input: unknown,
  maxCandidates: number,
): { readonly systemAsOf: string; readonly scopeRef?: string; readonly maxCandidates: number } => {
  if (typeof input !== 'object' || input === null) {
    throw new StorageInvalidCommandError('memory snapshot query requires an object input');
  }
  const candidate = input as Record<string, unknown>;
  const systemAsOf: unknown = candidate['system_as_of'];
  if (!isCanonicalU64(systemAsOf)) {
    throw new StorageInvalidCommandError('memory snapshot query requires a canonical u64 system_as_of');
  }
  const max: unknown = candidate['max_candidates'];
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1 || max > maxCandidates) {
    throw new StorageInvalidCommandError(`memory snapshot max_candidates must be within 1 and ${maxCandidates}`);
  }
  const scopeRef: unknown = candidate['scope_ref'];
  if (scopeRef !== undefined && (typeof scopeRef !== 'string' || scopeRef.length === 0)) {
    throw new StorageInvalidCommandError('memory snapshot scope_ref must be a non-empty string when present');
  }
  return { systemAsOf, scopeRef: scopeRef as string | undefined, maxCandidates: max };
};

export const memoryPgQuery = (name: MemoryQueryName): PgRegisteredQuery => {
  if (!isMemoryQueryName(name)) {
    throw new StorageInvalidCommandError(`unknown memory query: ${String(name)}`);
  }
  return async (supplied, context): Promise<PgQueryPage> => {
    if (context.cursor !== null && typeof context.cursor !== 'string') {
      throw new StorageInvalidCommandError('invalid memory query continuation');
    }
    switch (name) {
      case 'memory-journal-page':
      case 'memory-outbox-page':
        validateMemoryPageInput(supplied, context.limit);
        break;
      case 'memory-record-by-id':
        validateMemoryRecordByIdInput(supplied);
        break;
      case 'memory-accepted-snapshot':
        validateMemorySnapshotInput(supplied, context.limit);
        break;
      case 'scope-chain-index':
        break;
    }
    return pendingTables(name);
  };
};

const pendingTables = (name: string): PgQueryPage => {
  throw new StorageUnavailableError(`memory query ${name} requires the G1b memory projection tables`);
};

export const MEMORY_PG_QUERIES = Object.freeze({
  'memory-journal-page': memoryPgQuery('memory-journal-page'),
  'memory-record-by-id': memoryPgQuery('memory-record-by-id'),
  'memory-accepted-snapshot': memoryPgQuery('memory-accepted-snapshot'),
  'memory-outbox-page': memoryPgQuery('memory-outbox-page'),
  'scope-chain-index': memoryPgQuery('scope-chain-index'),
});
