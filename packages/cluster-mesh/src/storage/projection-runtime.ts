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

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Indexed relationship representation (§10.2): relation → from → to. */
export class ProjectionRuntime {
  private descriptor: ModuleDescriptor | null = null;
  private readonly relations = new Map<string, Map<string, Set<string>>>();
  private readonly emitted: ProjectionDelta[] = [];

  /** Register the trusted module descriptor (advertised queries, limits). */
  registerDescriptor(descriptor: ModuleDescriptor): void {
    const validity = validateModuleDescriptor(descriptor);
    if (!validity.ok) throw new StorageInvalidCommandError(validity.errors.join('; '));
    this.descriptor = descriptor;
  }

  /** Queries advertised by the registered descriptor, or none. */
  registeredQueries(): readonly string[] {
    return this.descriptor?.queryNames ?? [];
  }

  /** Page limits advertised by the registered descriptor, or null. */
  pageLimits(): { readonly maxRecords: number; readonly maxEncodedBytes: number } | null {
    return this.descriptor?.pageLimits ?? null;
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
      let targets = this.relations.get(change.relation);
      if (change.kind === 'add') {
        if (!targets) {
          targets = new Map();
          this.relations.set(change.relation, targets);
        }
        let members = targets.get(change.from);
        if (!members) {
          members = new Set();
          targets.set(change.from, members);
        }
        members.add(change.to);
        continue;
      }
      const members = targets?.get(change.from);
      if (!members || !members.has(change.to)) {
        throw new StorageInvalidCommandError('unknown relationship');
      }
      members.delete(change.to);
    }
  }

  /** Indexed lookup of relationship targets (§6.3 indexed backend joins). */
  queryRelationships(relation: string, from: string): readonly string[] {
    return [...(this.relations.get(relation)?.get(from) ?? [])];
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
    const stored: ProjectionDelta = { ...delta };
    this.emitted.push(stored);
    return stored;
  }

  /** Deltas emitted at publication, in commit order. */
  deltas(): readonly ProjectionDelta[] {
    return [...this.emitted];
  }
}
