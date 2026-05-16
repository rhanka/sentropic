import type { SkillRegistry } from './registry.js';
import type {
  AuthzContext,
  ResolvedTool,
  ToolRegistry,
} from './authz.js';
import { resolveAuthorizedTools } from './resolve.js';
import {
  SEARCH_SKILLS_RESOLVED_TOOL,
  SEARCH_SKILLS_TOOL_NAME,
  executeSearchSkills,
  type SearchSkillsInput,
} from './search-skills-tool.js';
import type { SkillSearchHit } from '../types/skill-search-hit.js';

/**
 * Adapter that bridges a `SkillRegistry` to the `ToolRegistry` contract
 * consumed by `chat-core` / `flow` / future runtimes.
 *
 * Why a separate class (vs. having `InMemorySkillRegistry` implement
 * `ToolRegistry` directly):
 *   - Composition over inheritance: `SkillsToolRegistry` is one of several
 *     `ToolRegistry` implementations a downstream `ChatToolRegistry` can
 *     federate (per SPEC_STUDY_ARCHITECTURE_BOUNDARIES §8 Q3).
 *   - Keeps `@sentropic/skills` free of `chat-core` types in the registry
 *     layer; only the adapter mentions `ResolvedTool` / `AuthzContext`.
 *   - Future hooks (marketplace overlay per SPEC_EVOL_BR19 §8) wrap this
 *     adapter, not the registry itself.
 *
 * The adapter holds no mutable state of its own — every call walks the
 * underlying registry through the source-of-truth `Iterable<Skill>`. This
 * means a skill registered AFTER the adapter is created is immediately
 * visible (no cache to invalidate).
 */
export class SkillsToolRegistry implements ToolRegistry {
  constructor(private readonly registry: SkillRegistry) {}

  resolveTools(
    authz: AuthzContext,
    options?: { skillName?: string },
  ): ReadonlyArray<ResolvedTool> {
    // `SkillRegistry` exposes `list()` for metadata projections, but to
    // resolve tools we need the full `Skill` (tool descriptors).
    // Walk the metadata listing and fetch each skill on demand — keeps the
    // underlying registry interface free of an extra `values()` method.
    const skills = this.registry
      .list()
      .map((meta) => this.registry.get(meta.name))
      .filter((skill): skill is NonNullable<typeof skill> => skill !== null);
    const tools = resolveAuthorizedTools(skills, authz, options);

    // Auto-register the `search_skills` meta-tool. It is the agent's only
    // entry point for catalog discovery, so it must always be exposed —
    // even when no user-defined skill is registered (empty catalog still
    // needs the search affordance) and even when the caller asked to scope
    // to a single skill (the meta-tool is never owned by a single skill).
    //
    // Suppression rule: when `options.skillName` targets a real skill, the
    // meta-tool is intentionally omitted — the caller has already chosen a
    // skill and discovery is no longer relevant for this resolve cycle.
    if (options?.skillName !== undefined) {
      return tools;
    }
    return [SEARCH_SKILLS_RESOLVED_TOOL, ...tools];
  }

  /**
   * Execute the `search_skills` meta-tool. Exposed as a method (rather than
   * through a `handlers` map on a synthetic Skill) so that chat-core can
   * dispatch directly when it sees `ResolvedTool.skillName === '__skills__'`
   * without instantiating any extra glue.
   *
   * Throws on invalid input shape; returns `[]` for an empty/whitespace
   * query (consistent with `SkillRegistry.search`).
   */
  executeSearchSkills(
    authz: AuthzContext,
    input: SearchSkillsInput,
  ): ReadonlyArray<SkillSearchHit> {
    if (!input || typeof input !== 'object') {
      throw new TypeError(
        `${SEARCH_SKILLS_TOOL_NAME}: input must be an object with a "query" string`,
      );
    }
    return executeSearchSkills(this.registry, authz, input);
  }
}

/**
 * Convenience factory mirroring `createIsolatedVmRuntime` style. Construct a
 * fresh adapter bound to the given registry.
 */
export function createSkillsToolRegistry(registry: SkillRegistry): SkillsToolRegistry {
  return new SkillsToolRegistry(registry);
}
