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
/**
 * Create a lifecycle event appended to the chain of one scoped object. Archive
 * and restore stay reversible; a tombstone is terminal for archive actions and
 * cannot be resurrected by any later event except the explicit purge
 * intent/outcome pipeline, which itself only follows a tombstone.
 */
export const createLifecycleEvent = (
  chain: readonly LifecycleEventRecord[],
  input: Omit<LifecycleEventRecord, 'kind' | 'link' | 'hash'>,
): LifecycleEventRecord => {
  if (!isLifecycleObjectKind(input.objectKind)) {
    throw new LifecycleValidationError('invalid-object', `Unknown lifecycle object kind: ${String(input.objectKind)}`);
  }
  if (!isLifecycleAction(input.action)) {
    throw new LifecycleValidationError('invalid-action', `Unknown lifecycle action: ${String(input.action)}`);
  }
  if (input.objectId.length === 0 || input.actor.principal.length === 0) {
    throw new LifecycleValidationError('invalid-object', 'Lifecycle needs an object id and an actor principal');
  }
  if (input.action === 'archive') {
    if (!isArchiveKind(input.archiveKind)) {
      throw new LifecycleValidationError('invalid-archive-kind', 'Archive requires a shared or personal audience');
    }
  } else if (input.archiveKind !== null) {
    throw new LifecycleValidationError('invalid-archive-kind', 'archiveKind applies only to archive actions');
  }
  const previous = chain.length > 0 ? chain[chain.length - 1] : null;
  if (previous !== null && (previous.objectKind !== input.objectKind || previous.objectId !== input.objectId || previous.scope.tenantId !== input.scope.tenantId || previous.scope.workspaceId !== input.scope.workspaceId)) {
    throw new LifecycleValidationError('invalid-sequence', 'Lifecycle chain is scoped to one object');
  }
  const projection = projectLifecycle(chain);
  if (input.action === 'archive' && projection.tombstoned) {
    throw new LifecycleValidationError('tombstoned', 'A tombstoned object cannot be archived');
  }
  if (input.action === 'restore' && !projection.archived) {
    throw new LifecycleValidationError('invalid-sequence', 'Only an archived object can be restored');
  }
  if (input.action === 'tombstone' && projection.tombstoned) {
    throw new LifecycleValidationError('tombstoned', 'A tombstone is irreversible');
  }
  if (input.action === 'purge-intent' && !projection.tombstoned) {
    throw new LifecycleValidationError('invalid-sequence', 'Purge intent requires a prior tombstone');
  }
  if (input.action === 'purge-outcome' && projection.purge !== 'intended') {
    throw new LifecycleValidationError('invalid-sequence', 'Purge outcome requires a prior purge intent');
  }
  const link = { sequence: previous === null ? 1 : previous.link.sequence + 1, previousHash: previous === null ? null : previous.hash };
  const envelope = { ...input, link };
  const hash = hashRecord('lifecycle-event', envelope as unknown as Record<string, unknown>);
  return { ...envelope, kind: 'lifecycle-event', hash };
};

export const projectLifecycleState = (chain: readonly LifecycleEventRecord[]): LifecycleProjection =>
  projectLifecycle(chain);
