import type {
  SkillToolHandler,
  SkillToolInvocation,
  SkillToolResult,
} from '../../../types/skill.js';

/**
 * Placeholder handlers for the `workspace` foundation skill.
 *
 * Lot 5 Wave A intentionally ships the skill descriptor + metadata WITHOUT
 * binding the handlers to the real API service: per BR-19 Lot 5 launch packet,
 * the legacy `api/src/services/tools.ts` entries (`workspace_list`,
 * `initiative_search`) remain the live execution path until `chat-service` is
 * rebound through `SkillsToolRegistry`.
 *
 * Until that rebind happens, these handlers must NEVER be invoked. If they
 * are, throwing surfaces the wiring bug at the call site instead of silently
 * returning an empty payload.
 */
const notBound: SkillToolHandler = (
  invocation: SkillToolInvocation,
): SkillToolResult => {
  throw new Error(
    `workspace skill handler "${invocation.toolName}" is not bound — ` +
      'invocation must still route through api/src/services/tools.ts ' +
      'until BR-19 Lot 5 rebinds chat-service to SkillsToolRegistry',
  );
};

export const workspaceHandlers: Readonly<Record<string, SkillToolHandler>> = {
  workspace_list: notBound,
  initiative_search: notBound,
};
