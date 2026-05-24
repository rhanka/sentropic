import type {
  SkillToolHandler,
  SkillToolInvocation,
  SkillToolResult,
} from '../../types/skill.js';

export function createNotBoundHandlers(
  skillName: string,
  toolNames: ReadonlyArray<string>,
): Readonly<Record<string, SkillToolHandler>> {
  const notBound: SkillToolHandler = (
    invocation: SkillToolInvocation,
  ): SkillToolResult => {
    throw new Error(
      `${skillName} skill handler "${invocation.toolName}" is not bound — ` +
        'route through api/src/services/tools.ts until BR-19 Lot 5 rebinds chat-service',
    );
  };

  return Object.fromEntries(toolNames.map((name) => [name, notBound]));
}
