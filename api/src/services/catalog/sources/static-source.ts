/**
 * StaticCatalogSource — wraps the foundation skill bundle (BR-42b Lot 1)
 *
 * Adapts `FOUNDATION_SKILLS` from `@sentropic/skills` into `skill`-kind
 * `CatalogEntry` objects. This source is always-fresh: its `snapshot()` is
 * derived entirely from the in-process constant array, so no `refresh()` is
 * needed and the snapshot is never stale.
 *
 * Ordering guarantee: entries are emitted in `FOUNDATION_SKILLS` array order,
 * which mirrors `InMemorySkillRegistry` Map insertion order. The
 * `CompositeCatalogRegistry.list()` call preserves this order, keeping the
 * 28-tool resolved sequence byte-identical to the pre-Lot-1 baseline.
 *
 * `packages/skills/src/**` is consumed READ-ONLY — this file is the only
 * place that imports from the package, and it does so via read-only imports
 * with zero modifications to the package source (plan-review MF3).
 */

import { FOUNDATION_SKILLS, type Skill } from '../../../../../packages/skills/src/index.js';
import type { CatalogSource } from '../source.js';
import type { CatalogEntry, SkillEntry } from '../types.js';

// ---------------------------------------------------------------------------
// StaticCatalogSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` backed by a frozen, statically-defined array of `Skill`
 * objects. Intended for the foundation bundle; can wrap any fixed skill set.
 *
 * Source id: `'foundation'`
 * Source kind: `'static'`
 */
export class StaticCatalogSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'static' as const;

  private readonly entries: ReadonlyArray<SkillEntry>;

  /**
   * Construct a static source from `FOUNDATION_SKILLS`.
   *
   * @param id  Source identifier. Defaults to `'foundation'`.
   */
  constructor(id = 'foundation') {
    this.id = id;
    // Map each Skill to a SkillEntry, preserving array order.
    this.entries = FOUNDATION_SKILLS.map((skill: Skill) => ({
      kind: 'skill' as const,
      sourceId: id,
      metadata: {
        name: skill.metadata.name,
        description: skill.metadata.description,
        version: skill.metadata.version,
        category: skill.metadata.category,
        contextFilter: skill.metadata.contextFilter,
        authzRequirements: skill.metadata.authzRequirements,
      },
      skill,
    }));
  }

  /**
   * SYNC — returns the pre-built entries array.
   * Always-fresh: backed by a compile-time constant; no I/O, no cache.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this.entries;
  }

  // No `refresh()` — static sources are always-fresh by definition.
  // No `health()` — in-process constant; never unhealthy.
}

// ---------------------------------------------------------------------------
// Module-level singleton (consumed by the wired catalog.ts)
// ---------------------------------------------------------------------------

/**
 * Singleton `StaticCatalogSource` for the foundation bundle.
 * Import this to wire the foundation into `CompositeCatalogRegistry`.
 */
export const foundationCatalogSource = new StaticCatalogSource('foundation');
