// Shared operational host for the A2.0b importer and atomic deletion: the
// transaction-scoped custody stores, the deletion journal over the same
// transaction, and the raw profile handle for bound business participants.

import type { IdentityCustodyStoresV1 } from '../../identity-contracts/custody.js';
import type { PostgresCustodyHandle } from './custody-postgres.js';
import type { SqliteCustodyHandle } from './custody-sqlite.js';
import type { PostgresCustodyJournal } from './custody-journal-postgres.js';
import type { SqliteCustodyJournal } from './custody-journal-sqlite.js';

export type AnyCustodyJournal = PostgresCustodyJournal | SqliteCustodyJournal;
export type AnyCustodyHandle = PostgresCustodyHandle | SqliteCustodyHandle;

export interface CustodyOpHost {
  readonly profile: 'postgres' | 'sqlite';
  readonly stores: IdentityCustodyStoresV1;
  readonly journal: AnyCustodyJournal;
  /** Raw profile handle for bound business SQL: PgSession or SqliteConnection. */
  readonly raw: unknown;
}
