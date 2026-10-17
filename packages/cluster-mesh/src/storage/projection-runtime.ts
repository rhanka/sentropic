// K4 projection runtime (L3a v4.1 frozen §6.2-§6.4, §10.2): descriptor-backed
// query advertisement with page limits, an indexed relationship
// representation, and cause-tagged projection deltas emitted at publication.
// Data-only: the staged runtime drives it at its single publication point.
// No pg, no drizzle, no engram imports.

import { StorageInvalidCommandError } from './errors.js';
import {
  validateModuleDescriptor,
  validateProjectionDelta,
  type ModuleDescriptor,
  type ProjectionCause,
  type ProjectionDelta,
} from './descriptor.js';
import type { RelationshipChange } from './atomic.js';
import { IndexedMap } from './indexed-map.js';
import { IndexedHistory } from './indexed-history.js';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Indexed relationship representation (§10.2): relation → from → to. */
export class ProjectionRuntime {
  private descriptor: ModuleDescriptor | null = null;
  private relations = new IndexedMap<IndexedMap<true>>();
  private emitted = new IndexedHistory<ProjectionDelta>();

  fork(): ProjectionRuntime {
    const next = new ProjectionRuntime();
    next.descriptor = this.descriptor;
    next.relations = this.relations.fork();
    next.emitted = this.emitted.fork();
    return next;
  }

  lock(): void { this.relations.lock(); this.emitted.lock(); }

  /** Register the trusted module descriptor (advertised queries, limits). */
  registerDescriptor(descriptor: ModuleDescriptor): void {
    const validity = validateModuleDescriptor(descriptor);
    if (!validity.ok) throw new StorageInvalidCommandError(validity.errors.join('; '));
    const owned = JSON.parse(JSON.stringify(descriptor)) as ModuleDescriptor;
    for (const value of Object.values(owned)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(owned.pageLimits);
    this.descriptor = Object.freeze(owned);
  }

  /** Queries advertised by the registered descriptor, or none. */
  registeredQueries(): readonly string[] {
    return [...(this.descriptor?.queryNames ?? [])];
  }

  /** Page limits advertised by the registered descriptor, or null. */
  pageLimits(): { readonly maxRecords: number; readonly maxEncodedBytes: number } | null {
    return this.descriptor ? { ...this.descriptor.pageLimits } : null;
  }

  /**
   * Apply relationship changes to the index. Adds are idempotent;
   * removing an absent relationship is an invalid command. Positive
   * relationship cases are owned by K4.
   */
  applyRelationships(changes: readonly RelationshipChange[]): void {
    for (const change of changes) {
      if (change.kind !== 'add' && change.kind !== 'remove') {
        throw new StorageInvalidCommandError('relationship kind must be add or remove');
      }
      if (!nonEmpty(change.relation) || !nonEmpty(change.from) || !nonEmpty(change.to)) {
        throw new StorageInvalidCommandError('relationships require a relation, from and to');
      }
      const key = JSON.stringify([change.relation, change.from]);
      const members = (this.relations.get(key) ?? new IndexedMap<true>()).fork();
      if (change.kind === 'remove' && !members.has(change.to)) {
        throw new StorageInvalidCommandError('unknown relationship');
      }
      if (change.kind === 'add') members.set(change.to, true);
      else members.delete(change.to);
      this.relations.set(key, members.lock());
    }
  }

  /** Indexed lookup of relationship targets (§6.3 indexed backend joins). */
  queryRelationships(relation: string, from: string): readonly string[] {
    return [...(this.relations.get(JSON.stringify([relation, from]))?.keys() ?? [])];
  }

  hasRelationship(relation: string, from: string, to: string): boolean {
    return this.relations.get(JSON.stringify([relation, from]))?.has(to) ?? false;
  }

  /**
   * Emit a cause-tagged projection delta at publication (§6.2). Hidden-stage
   * projections stay hidden: deltas are recorded only for published changes.
   */
  emitDelta(delta: {
    readonly cause: ProjectionCause;
    readonly records: readonly string[];
    readonly aggregates: readonly string[];
    readonly relationships: readonly string[];
    readonly barriers: readonly string[];
    readonly unitId?: string;
  }): ProjectionDelta {
    const validity = validateProjectionDelta(delta);
    if (!validity.ok) throw new StorageInvalidCommandError(validity.errors.join('; '));
    const stored: ProjectionDelta = Object.freeze({ ...delta,
      records: Object.freeze([...delta.records]), aggregates: Object.freeze([...delta.aggregates]),
      relationships: Object.freeze([...delta.relationships]), barriers: Object.freeze([...delta.barriers]),
    });
    this.emitted.push(stored);
    return JSON.parse(JSON.stringify(stored)) as ProjectionDelta;
  }

  /** Deltas emitted at publication, in commit order. */
  get deltaCount(): number { return this.emitted.length; }

  deltas(after = 0, limit = 100): readonly ProjectionDelta[] {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StorageInvalidCommandError('projection reader requires a bounded window');
    }
    const rows: ProjectionDelta[] = [];
    for (let n = after; n < Math.min(this.emitted.length, after + limit); n += 1) rows.push(this.emitted.at(n)!);
    return JSON.parse(JSON.stringify(rows)) as ProjectionDelta[];
  }
}
