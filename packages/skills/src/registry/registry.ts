import type { Skill } from '../types/skill.js';
import type { SkillMetadata } from '../types/metadata.js';
import type { SkillSearchHit, SkillSearchMatchedField } from '../types/skill-search-hit.js';

/**
 * Optional filter applied to `SkillRegistry.list()`. All populated fields are
 * AND-combined: a skill must satisfy every populated dimension. Omitted fields
 * are wildcards.
 */
export interface SkillListFilter {
  readonly category?: string;
  readonly workspaceType?: string;
  readonly role?: string;
}

/**
 * Search options for `SkillRegistry.search()`.
 */
export interface SkillSearchOptions {
  /** Maximum number of hits returned. Defaults to 5; capped at 50. */
  readonly topK?: number;
  /** Optional category filter applied before ranking. */
  readonly categoryHint?: string;
}

/**
 * In-memory catalog of registered skills. Backed by a `Map<name, Skill>` so
 * `register` / `get` are O(1); `list` and `search` are O(n) over the entries.
 *
 * Authz-aware filtering (`resolveTools(authz)`) is layered on top in
 * `SkillsToolRegistry` to keep this class free of `@sentropic/contracts`
 * coupling (per the package boundary frozen in SPEC_EVOL_BR19 §3).
 */
export interface SkillRegistry {
  /**
   * Register a skill in the catalog. Throws if a skill with the same
   * `metadata.name` is already registered.
   */
  register(skill: Skill): void;
  /** Remove a skill by name. No-op when the name is not registered. */
  unregister(name: string): void;
  /**
   * Lightweight projection of every registered skill. Filtering is
   * AND-combined; omitted fields are wildcards.
   */
  list(filter?: SkillListFilter): ReadonlyArray<SkillMetadata>;
  /** Full skill bundle for execution; `null` when not registered. */
  get(name: string): Skill | null;
  /**
   * Description-match search. v0.1 ranking is a token-frequency heuristic over
   * `name`, `description`, `category` (BM25 simplified — no IDF table).
   */
  search(query: string, options?: SkillSearchOptions): ReadonlyArray<SkillSearchHit>;
}

/** Hard ceiling for `topK` accepted by `search()`. */
const MAX_TOP_K = 50;

/** Default `topK` when caller does not specify one. */
const DEFAULT_TOP_K = 5;

/**
 * Tokenize a string for the search heuristic: lowercase, split on
 * non-alphanumerics, drop empty tokens. Kept here (not exported) because the
 * tokenizer choice is an implementation detail of v0.1 ranking.
 */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

/**
 * Score a single field against query tokens. Returns the count of distinct
 * query tokens present in the field. Distinct (not cumulative) so that a
 * field stuffed with one repeated word does not dominate ranking.
 */
function scoreField(fieldValue: string, queryTokens: ReadonlyArray<string>): number {
  if (queryTokens.length === 0 || fieldValue.length === 0) return 0;
  const fieldTokens = new Set(tokenize(fieldValue));
  let score = 0;
  for (const token of queryTokens) {
    if (fieldTokens.has(token)) score += 1;
  }
  return score;
}

/**
 * Concrete in-memory `SkillRegistry`. Construct one per process; share via
 * dependency injection. Not thread-safe (Node single-threaded; if cross-thread
 * sharing is ever needed, wrap in a structured-clone capable transport).
 */
export class InMemorySkillRegistry implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    const { name } = skill.metadata;
    if (!name || name.length === 0) {
      throw new Error('SkillRegistry.register: skill.metadata.name is required');
    }
    if (this.skills.has(name)) {
      throw new Error(`SkillRegistry.register: skill "${name}" already registered`);
    }
    this.skills.set(name, skill);
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  list(filter?: SkillListFilter): ReadonlyArray<SkillMetadata> {
    const out: SkillMetadata[] = [];
    for (const skill of this.skills.values()) {
      if (filter && !matchesListFilter(skill.metadata, filter)) continue;
      out.push(skill.metadata);
    }
    return out;
  }

  get(name: string): Skill | null {
    return this.skills.get(name) ?? null;
  }

  search(query: string, options?: SkillSearchOptions): ReadonlyArray<SkillSearchHit> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const requestedTopK = options?.topK ?? DEFAULT_TOP_K;
    const topK = Math.min(Math.max(1, requestedTopK), MAX_TOP_K);
    const categoryHint = options?.categoryHint;

    const hits: SkillSearchHit[] = [];
    for (const skill of this.skills.values()) {
      const meta = skill.metadata;
      if (categoryHint && meta.category !== categoryHint) continue;

      const nameScore = scoreField(meta.name, queryTokens);
      const descScore = scoreField(meta.description, queryTokens);
      const catScore = scoreField(meta.category, queryTokens);
      // Field weights: name dominates exact intent, description carries
      // semantic match, category is a coarse tiebreak.
      const score = nameScore * 3 + descScore * 2 + catScore * 1;
      if (score === 0) continue;

      const matchedFields: SkillSearchMatchedField[] = [];
      if (nameScore > 0) matchedFields.push('name');
      if (descScore > 0) matchedFields.push('description');
      if (catScore > 0) matchedFields.push('category');

      hits.push({ metadata: meta, score, matchedFields });
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.metadata.name.localeCompare(b.metadata.name);
    });
    return hits.slice(0, topK);
  }
}

/**
 * Predicate used by `list()`. Extracted for unit-test direct coverage and to
 * keep `list()` linear and readable.
 */
function matchesListFilter(metadata: SkillMetadata, filter: SkillListFilter): boolean {
  if (filter.category && metadata.category !== filter.category) return false;
  const cf = metadata.contextFilter;
  if (filter.workspaceType) {
    const wsTypes = cf?.workspaceTypes;
    // No declared workspaceTypes = always available; non-empty list = must include.
    if (wsTypes && wsTypes.length > 0 && !wsTypes.includes(filter.workspaceType)) {
      return false;
    }
  }
  if (filter.role) {
    const roles = cf?.roles;
    if (roles && roles.length > 0 && !roles.includes(filter.role)) {
      return false;
    }
  }
  return true;
}
