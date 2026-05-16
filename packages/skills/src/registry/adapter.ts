import type { SkillRegistry } from './registry.js';
import type {
  AuthzContext,
  ResolvedTool,
  ToolRegistry,
} from './authz.js';
import { resolveAuthorizedTools } from './resolve.js';

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
    return resolveAuthorizedTools(skills, authz, options);
  }
}

/**
 * Convenience factory mirroring `createIsolatedVmRuntime` style. Construct a
 * fresh adapter bound to the given registry.
 */
export function createSkillsToolRegistry(registry: SkillRegistry): SkillsToolRegistry {
  return new SkillsToolRegistry(registry);
}
