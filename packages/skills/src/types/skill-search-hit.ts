import type { SkillMetadata } from './metadata.js';

/**
 * Field that contributed to a `SkillSearchHit` score. Useful for explainability
 * (`why was this skill ranked?`) and for UI faceting of search results.
 */
export type SkillSearchMatchedField = 'name' | 'description' | 'category';

/**
 * Single entry returned by `SkillRegistry.search(query, ctx)`. Hits are
 * pre-filtered through `AuthzContext` before ranking — denied skills are
 * never returned, even at score 0 (SPEC_EVOL_BR19 §5).
 */
export interface SkillSearchHit {
  /** Lightweight skill metadata projection. */
  readonly metadata: SkillMetadata;
  /** Ranking score (higher = better match). Ranking algorithm is BM25 in v0.1. */
  readonly score: number;
  /** Fields that contributed to the score. */
  readonly matchedFields: ReadonlyArray<SkillSearchMatchedField>;
}
