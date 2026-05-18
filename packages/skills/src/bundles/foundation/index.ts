import type { SkillRegistry } from '../../registry/registry.js';
import type { Skill } from '../../types/skill.js';
import { webSkill } from './web/index.js';
import { workspaceSkill } from './workspace/index.js';

/**
 * Built-in foundation skill bundle for `@sentropic/skills`.
 *
 * The foundation bundle ships the safest, lowest-risk skills migrated from
 * `api/src/services/tools.ts` (BR-19 Lot 5 Wave A): read-only, no sandbox,
 * no DB writes, no side effects. It exists to validate the bundle/registrar
 * pattern before the heavier waves (B/C/D) migrate object skills, structured
 * writes, and sandbox-backed skills respectively.
 *
 * Wave A contents (frozen):
 *   - `workspace` — cross-workspace navigation (`workspace_list`,
 *     `initiative_search`).
 *   - `web` — online search and page extraction (`web_search`,
 *     `web_extract`).
 *
 * Wave B will add `organizations`, `folders`, `initiatives`, … bundles —
 * each as a sibling of `./workspace/`.
 */
export const FOUNDATION_SKILLS: ReadonlyArray<Skill> = Object.freeze([
  workspaceSkill,
  webSkill,
]);

/**
 * Register every foundation skill into the given `SkillRegistry`. Idempotent
 * registration is NOT supported (the underlying `SkillRegistry.register`
 * throws on duplicate names); callers must use a fresh registry or unregister
 * conflicting names first.
 *
 * Returned: the list of skill names actually registered, in registration order.
 * Useful for boot-time logging.
 */
export function registerFoundationSkills(
  registry: SkillRegistry,
): ReadonlyArray<string> {
  const names: string[] = [];
  for (const skill of FOUNDATION_SKILLS) {
    registry.register(skill);
    names.push(skill.metadata.name);
  }
  return names;
}

export { workspaceSkill } from './workspace/index.js';
export { webSkill } from './web/index.js';
