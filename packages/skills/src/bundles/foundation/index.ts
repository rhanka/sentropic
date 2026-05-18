import type { SkillRegistry } from '../../registry/registry.js';
import type { Skill } from '../../types/skill.js';
import { executiveSummarySkill } from './executive_summary/index.js';
import { foldersSkill } from './folders/index.js';
import { gateReviewSkill } from './gate_review/index.js';
import { historyAnalyzeSkill } from './history_analyze/index.js';
import { initiativesSkill } from './initiatives/index.js';
import { matrixSkill } from './matrix/index.js';
import { organizationsSkill } from './organizations/index.js';
import { productsSkill } from './products/index.js';
import { proposalsSkill } from './proposals/index.js';
import { solutionsSkill } from './solutions/index.js';
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
 * Wave B contents:
 *   - `organizations`, `folders`, `initiatives`, `solutions`, `proposals`,
 *     `products` — workspace-scoped object metadata and guard handlers.
 *
 * Wave C package-only first sub-lot:
 *   - `executive_summary`, `matrix` — structured folder analysis metadata with
 *     not-bound handlers only. API runtime rebind stays deferred.
 *
 * Wave C package-only second sub-lot:
 *   - `history_analyze`, `gate_review` — structured/read-only analysis skills
 *     with not-bound handlers only. API runtime rebind stays deferred.
 */
export const FOUNDATION_SKILLS: ReadonlyArray<Skill> = Object.freeze([
  workspaceSkill,
  webSkill,
  organizationsSkill,
  foldersSkill,
  initiativesSkill,
  solutionsSkill,
  proposalsSkill,
  productsSkill,
  executiveSummarySkill,
  matrixSkill,
  historyAnalyzeSkill,
  gateReviewSkill,
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
export { organizationsSkill } from './organizations/index.js';
export { foldersSkill } from './folders/index.js';
export { initiativesSkill } from './initiatives/index.js';
export { solutionsSkill } from './solutions/index.js';
export { proposalsSkill } from './proposals/index.js';
export { productsSkill } from './products/index.js';
export { executiveSummarySkill } from './executive_summary/index.js';
export { matrixSkill } from './matrix/index.js';
export { historyAnalyzeSkill } from './history_analyze/index.js';
export { gateReviewSkill } from './gate_review/index.js';
