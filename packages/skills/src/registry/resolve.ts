import type { Skill } from '../types/skill.js';
import type { SkillTool } from '../types/skill-tool.js';
import type { SkillMetadata } from '../types/metadata.js';
import type { AuthzContext, ResolvedTool } from './authz.js';

/**
 * Decide whether a skill is exposed to a caller given `AuthzContext`.
 *
 * Order of evaluation (cheapest first; short-circuit on first deny):
 *   1. `contextFilter.workspaceTypes`: must include `authz.tenant.workspaceType`
 *      (or be empty/omitted). When the caller has no workspace type and the
 *      skill declares one, the skill is denied (cannot prove relevance).
 *   2. `contextFilter.roles`: caller must hold at least one of the declared
 *      roles. Empty/omitted = any role.
 *   3. `authzRequirements.permissions`: caller must hold ALL of the declared
 *      permissions (AND-combined). Empty/omitted = no extra permissions
 *      required.
 *
 * The `permissionMode` / `allowedTools` filter is applied at the tool level
 * inside `resolveTools()`, not here, because a skill can expose multiple tools
 * with different allowlist coverage.
 */
export function isSkillVisibleTo(metadata: SkillMetadata, authz: AuthzContext): boolean {
  const cf = metadata.contextFilter;

  if (cf?.workspaceTypes && cf.workspaceTypes.length > 0) {
    const wsType = authz.tenant.workspaceType;
    if (!wsType || !cf.workspaceTypes.includes(wsType)) {
      return false;
    }
  }

  if (cf?.roles && cf.roles.length > 0) {
    const hasRole = cf.roles.some((r) => authz.roles.includes(r));
    if (!hasRole) return false;
  }

  const required = metadata.authzRequirements?.permissions;
  if (required && required.length > 0) {
    const hasAll = required.every((p) => authz.permissions.includes(p));
    if (!hasAll) return false;
  }

  return true;
}

/**
 * Decide whether an individual tool is callable under the caller's
 * `permissionMode`:
 *   - 'open': any tool of a visible skill is callable.
 *   - 'allowlist': only tools whose `name` is in `authz.allowedTools` are
 *     callable. The skill itself must still pass `isSkillVisibleTo`.
 */
export function isToolCallableUnder(toolName: string, authz: AuthzContext): boolean {
  if (authz.permissionMode === 'open') return true;
  return authz.allowedTools.includes(toolName);
}

/**
 * Project a `SkillTool` into the `ResolvedTool` envelope. Pure function;
 * no I/O.
 */
function toResolvedTool(skillName: string, tool: SkillTool): ResolvedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
    skillName,
    sideEffect: tool.sideEffect,
    requiresApproval: tool.requiresApproval,
  };
}

/**
 * Resolve every tool exposed to `authz` across the registered skills.
 * Optionally narrow to a single skill via `options.skillName` (used by
 * `chat-core` after `search_skills` returned a hit).
 *
 * Implementation note: this function is exported so the `SkillsToolRegistry`
 * adapter (`adapter.ts`) and tests can share the exact filtering logic
 * without depending on the registry class itself.
 */
export function resolveAuthorizedTools(
  skills: Iterable<Skill>,
  authz: AuthzContext,
  options?: { skillName?: string },
): ResolvedTool[] {
  const out: ResolvedTool[] = [];
  for (const skill of skills) {
    if (options?.skillName && skill.metadata.name !== options.skillName) continue;
    if (!isSkillVisibleTo(skill.metadata, authz)) continue;
    for (const tool of skill.tools) {
      if (!isToolCallableUnder(tool.name, authz)) continue;
      out.push(toResolvedTool(skill.metadata.name, tool));
    }
  }
  return out;
}
