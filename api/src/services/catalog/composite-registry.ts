/**
 * CompositeCatalogRegistry (BR-42b Lot 1)
 *
 * Fans `list / get / search` across the snapshots of one or more
 * `CatalogSource` instances.
 *
 * Ordering guarantee (SPEC_EVOL_CATALOG §3.2, plan-review MF1):
 *   The `list()` result preserves source registration order AND each source's
 *   own entry order. Specifically, the foundation source (`StaticCatalogSource`,
 *   id `'foundation'`) is registered first and its entries appear first in the
 *   list — which means the `InMemorySkillRegistry` Map insertion order (the
 *   28-tool oracle in `catalog-characterization.spec.ts §7`) is preserved.
 *
 * Collision policy:
 *   When two sources emit entries with the same `metadata.name`, the FIRST
 *   registered source wins (foundation-precedence). Later sources' entries with
 *   conflicting names are silently dropped from `list()` and `get()`.
 *
 * Search:
 *   A simple token-frequency search over the entries from all sources, ordered
 *   by descending score then name. Mirrors `InMemorySkillRegistry.search()`.
 */

import type { CatalogSource } from './source.js';
import type { CatalogEntry } from './types.js';
import { isTrustedCatalogContext, type CatalogRequestContext } from './request-context.js';

// ---------------------------------------------------------------------------
// Tokenizer — same logic as InMemorySkillRegistry for consistency
// ---------------------------------------------------------------------------

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

function scoreField(fieldValue: string, queryTokens: ReadonlyArray<string>): number {
  if (queryTokens.length === 0 || !fieldValue || fieldValue.length === 0) return 0;
  const fieldTokens = new Set(tokenize(fieldValue));
  let score = 0;
  for (const token of queryTokens) {
    if (fieldTokens.has(token)) score += 1;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export interface CatalogSearchOptions {
  /** Maximum number of hits returned. Defaults to 5; capped at 50. */
  readonly topK?: number;
  /** Optional kind filter applied before ranking. */
  readonly kindHint?: string;
  /** Optional category filter applied before ranking. */
  readonly categoryHint?: string;
}

export interface CatalogSearchHit {
  readonly entry: CatalogEntry;
  readonly score: number;
  readonly matchedFields: string[];
}

const MAX_TOP_K = 50;
const DEFAULT_TOP_K = 5;

// ---------------------------------------------------------------------------
// CompositeCatalogRegistry
// ---------------------------------------------------------------------------

/**
 * Aggregates entries from multiple `CatalogSource` instances.
 *
 * Sources are consulted via their synchronous `snapshot()` method, which is
 * always safe to call on the hot path.
 */
export class CompositeCatalogRegistry {
  private readonly sources: CatalogSource[] = [];

  /**
   * Register a source. Sources are queried in registration order.
   * The first registered source has the highest collision precedence.
   */
  addSource(source: CatalogSource): this {
    this.sources.push(source);
    return this;
  }

  /**
   * Return registered sources (in registration order).
   */
  getSources(context?: CatalogRequestContext): ReadonlyArray<CatalogSource> {
    return this.sources.filter(source => context === undefined
      ? !source.requiresContext : this.entries(source, context).length > 0);
  }

  private entries(source: CatalogSource, context?: CatalogRequestContext): readonly CatalogEntry[] {
    if ((context !== undefined || source.requiresContext) && !isTrustedCatalogContext(context)) return [];
    return source.snapshot(context).flatMap(entry => {
      if (!context) return [entry];
      const permitted = (name: string, sideEffect?: boolean) => context.allowedTools.includes(name)
        && (!context.readOnly || sideEffect === false);
      if (entry.kind === 'tool') return permitted(entry.metadata.name, entry.tool.sideEffect) ? [entry] : [];
      if (entry.kind === 'skill') {
        const tools = entry.skill.tools.filter(tool => permitted(tool.name, tool.sideEffect));
        return tools.length ? [{ ...entry, skill: { ...entry.skill, tools,
          metadata: { ...entry.skill.metadata, toolNames: tools.map(tool => tool.name) } } }] : [];
      }
      return [entry];
    });
  }

  /**
   * List all catalog entries, preserving source order and within-source entry
   * order. Entries with duplicate `metadata.name` values are deduplicated by
   * keeping the first-registered source's entry (foundation-precedence).
   *
   * This method is synchronous and consumes each source's `snapshot()`.
   */
  list(context?: CatalogRequestContext): ReadonlyArray<CatalogEntry> {
    const seen = new Set<string>();
    const result: CatalogEntry[] = [];
    for (const source of this.sources) {
      for (const entry of this.entries(source, context)) {
        const name = entry.metadata.name;
        if (seen.has(name)) continue; // collision: first source wins
        seen.add(name);
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Get a catalog entry by `metadata.name`.
   * Returns the first matching entry across all sources (foundation-precedence).
   * Returns `null` when no entry is found.
   *
   * This method is synchronous and consumes each source's `snapshot()`.
   */
  get(name: string, context?: CatalogRequestContext): CatalogEntry | null {
    for (const source of this.sources) {
      for (const entry of this.entries(source, context)) {
        if (entry.metadata.name === name) {
          return entry;
        }
      }
    }
    return null;
  }

  /**
   * Search catalog entries using token-frequency scoring over `name`,
   * `description`, and `category` fields (same weights as
   * `InMemorySkillRegistry.search`).
   *
   * Results are ordered by descending score, ties broken by name.
   * An empty / whitespace query returns `[]`.
   *
   * This method is synchronous and consumes each source's `snapshot()`.
   */
  search(query: string, options?: CatalogSearchOptions, context?: CatalogRequestContext): ReadonlyArray<CatalogSearchHit> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const requestedTopK = options?.topK ?? DEFAULT_TOP_K;
    const topK = Math.min(Math.max(1, requestedTopK), MAX_TOP_K);
    const kindHint = options?.kindHint;
    const categoryHint = options?.categoryHint;

    const seen = new Set<string>(); // same collision policy as list()
    const hits: CatalogSearchHit[] = [];

    for (const source of this.sources) {
      for (const entry of this.entries(source, context)) {
        const name = entry.metadata.name;
        if (seen.has(name)) continue;
        seen.add(name);

        if (kindHint && entry.kind !== kindHint) continue;
        if (categoryHint && entry.metadata.category !== categoryHint) continue;

        const meta = entry.metadata;
        const nameScore = scoreField(meta.name, queryTokens);
        const descScore = scoreField(meta.description, queryTokens);
        const catScore = scoreField(meta.category ?? '', queryTokens);
        // Field weights: name × 3, description × 2, category × 1
        const score = nameScore * 3 + descScore * 2 + catScore * 1;
        if (score === 0) continue;

        const matchedFields: string[] = [];
        if (nameScore > 0) matchedFields.push('name');
        if (descScore > 0) matchedFields.push('description');
        if (catScore > 0) matchedFields.push('category');

        hits.push({ entry, score, matchedFields });
      }
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.metadata.name.localeCompare(b.entry.metadata.name);
    });

    return hits.slice(0, topK);
  }
}
