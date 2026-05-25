import type { ContextFilter } from './context-filter.js';
import type { SandboxPolicy } from './sandbox-policy.js';

/**
 * Fine-grained authorization requirements that override `ContextFilter.roles`
 * when present (per SPEC_EVOL_BR19 §1.1 / BR19-Q4).
 */
export interface SkillAuthzRequirements {
  /**
   * Logical permission slugs the AuthzContext.allowedTools must include
   * for the skill to be exposed.
   */
  readonly permissions?: ReadonlyArray<string>;
}

/**
 * Lightweight, registry-facing projection of a `Skill`. `SkillRegistry.list()`
 * and `search()` return `SkillMetadata`, never the full `Skill`, so that the
 * registry surface is cheap to ship over IPC or HTTP without leaking executor
 * code.
 */
export interface SkillMetadata {
  /** Unique skill name within the source registry. Kebab-case. */
  readonly name: string;
  /**
   * LLM-readable description (≤ 280 chars) used for description-match
   * discovery via the `search_skills` meta-tool.
   */
  readonly description: string;
  /** Semver version of the skill bundle. */
  readonly version: string;
  /** Free taxonomy (document | object | web | workflow | analysis | …). */
  readonly category: string;
  /** Optional context filter; omitted means "always available". */
  readonly contextFilter?: ContextFilter;
  /** Optional sandbox policy; omitted means "native handlers only". */
  readonly sandbox?: SandboxPolicy;
  /** Optional explicit authz requirements (fine grain). */
  readonly authzRequirements?: SkillAuthzRequirements;
  /**
   * Tool names exposed by the skill (cheap projection for listing UIs without
   * loading the full tool descriptors).
   */
  readonly toolNames: ReadonlyArray<string>;
}
