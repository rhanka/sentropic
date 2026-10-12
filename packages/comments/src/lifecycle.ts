/**
 * Canonical lifecycle contracts (SPEC §4.4, §6.3/7.1, S-R13).
 *
 * Lifecycle events form one hash chain per scoped object, separate from every
 * content revision chain: archive is reversible and never part of content
 * hashes, tombstone is irreversible, and purge carries an explicit intent then
 * outcome. The availability projection below is computed, never hashed, and
 * recovery cannot resurrect a tombstoned object: no lifecycle event may follow
 * a tombstone except the explicit purge pipeline.
 */

import { hashRecord } from './revision-hash.js';
import type { CanonicalStoreScope } from './command-store.js';

/** Scoped objects with their own lifecycle chain. */
export const LIFECYCLE_OBJECT_KINDS = ['annotation', 'thread', 'comment'] as const;

export type LifecycleObjectKind = (typeof LIFECYCLE_OBJECT_KINDS)[number];

export const isLifecycleObjectKind = (value: unknown): value is LifecycleObjectKind =>
  typeof value === 'string' && (LIFECYCLE_OBJECT_KINDS as readonly string[]).includes(value);

/** Closed lifecycle action set: reversible archive, irreversible tombstone, explicit purge. */
export const LIFECYCLE_ACTIONS = ['archive', 'restore', 'tombstone', 'purge-intent', 'purge-outcome'] as const;

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const isLifecycleAction = (value: unknown): value is LifecycleAction =>
  typeof value === 'string' && (LIFECYCLE_ACTIONS as readonly string[]).includes(value);

/** Shared/personal archive audiences (S-R13); irrelevant outside archive actions. */
export const ARCHIVE_KINDS = ['shared', 'personal'] as const;

export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

export const isArchiveKind = (value: unknown): value is ArchiveKind =>
  typeof value === 'string' && (ARCHIVE_KINDS as readonly string[]).includes(value);

/** Lifecycle validation error with a closed reason code. */
export class LifecycleValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid-action'
      | 'invalid-object'
      | 'invalid-archive-kind'
      | 'invalid-sequence'
      | 'tombstoned',
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleValidationError';
  }
}

/** Immutable lifecycle event (hashed record kind `lifecycle-event`). */
export type LifecycleEventRecord = {
  readonly kind: 'lifecycle-event';
  readonly scope: CanonicalStoreScope;
  readonly objectKind: LifecycleObjectKind;
  readonly objectId: string;
  readonly link: { readonly sequence: number; readonly previousHash: string | null };
  readonly action: LifecycleAction;
  /** Required for archive actions: shared or personal audience. */
  readonly archiveKind: ArchiveKind | null;
  readonly actor: { readonly principal: string };
  readonly reason: string | null;
  readonly hash: string;
};

/** Explicit purge state, projected from the chain; never a mutable stored flag. */
export type PurgeState = 'none' | 'intended' | 'purged';

/** Availability projection; computed from the chain and never hashed. */
export type LifecycleProjection = {
  readonly archived: boolean;
  readonly archiveKind: ArchiveKind | null;
  readonly tombstoned: boolean;
  readonly purge: PurgeState;
  readonly available: boolean;
};

const projectLifecycle = (chain: readonly LifecycleEventRecord[]): LifecycleProjection => {
  let archived = false;
  let archiveKind: ArchiveKind | null = null;
  let tombstoned = false;
  let purge: PurgeState = 'none';
  for (const event of chain) {
    switch (event.action) {
      case 'archive':
        archived = true;
        archiveKind = event.archiveKind;
        break;
      case 'restore':
        archived = false;
        archiveKind = null;
        break;
      case 'tombstone':
        tombstoned = true;
        break;
      case 'purge-intent':
        purge = 'intended';
        break;
      case 'purge-outcome':
        purge = 'purged';
        break;
    }
  }
  return { archived, archiveKind, tombstoned, purge, available: !tombstoned && purge !== 'purged' };
};
