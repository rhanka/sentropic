// engram-memory SQLite named queries: the same five registered queries
// with the same input validation as Postgres. Execution against the
// durable SQLite backend lands in G1d with the qualified host provider
// seam; until then every validated query refuses instead of falling back
// to the generic in-memory kernel.

import { StorageUnavailableError } from '../storage/errors.js';
import {
  isMemoryQueryName,
  validateMemoryPageInput,
  validateMemoryRecordByIdInput,
  validateMemorySnapshotInput,
  type MemoryQueryName,
} from './postgres-queries.js';
import { MEMORY_QUERY_NAMES } from './manifest.js';

export const memorySqliteQuery = (name: MemoryQueryName): ((input: unknown, limit: number) => Promise<never>) => {
  if (!isMemoryQueryName(name)) throw new Error(`unknown memory query: ${String(name)}`);
  return async (supplied: unknown, limit: number): Promise<never> => {
    switch (name) {
      case 'memory-journal-page':
      case 'memory-outbox-page':
        validateMemoryPageInput(supplied, limit);
        break;
      case 'memory-record-by-id':
        validateMemoryRecordByIdInput(supplied);
        break;
      case 'memory-accepted-snapshot':
        validateMemorySnapshotInput(supplied, limit);
        break;
      case 'scope-chain-index':
        break;
    }
    throw new StorageUnavailableError(`memory query ${name} requires the G1d qualified SQLite backend`);
  };
};

export const MEMORY_SQLITE_QUERIES = Object.freeze({
  'memory-journal-page': memorySqliteQuery('memory-journal-page'),
  'memory-record-by-id': memorySqliteQuery('memory-record-by-id'),
  'memory-accepted-snapshot': memorySqliteQuery('memory-accepted-snapshot'),
  'memory-outbox-page': memorySqliteQuery('memory-outbox-page'),
  'scope-chain-index': memorySqliteQuery('scope-chain-index'),
});

export const MEMORY_SQLITE_QUERY_NAMES: readonly string[] = MEMORY_QUERY_NAMES;
