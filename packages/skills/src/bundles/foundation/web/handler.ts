import type {
  SkillToolHandler,
  SkillToolInvocation,
  SkillToolResult,
} from '../../../types/skill.js';

const notBound: SkillToolHandler = (
  invocation: SkillToolInvocation,
): SkillToolResult => {
  throw new Error(
    `web skill handler "${invocation.toolName}" is not bound — ` +
      'route through api/src/services/tools.ts until BR-19 Lot 5 rebinds chat-service',
  );
};

export const webHandlers: Readonly<Record<string, SkillToolHandler>> = {
  web_search: notBound,
  web_extract: notBound,
};
