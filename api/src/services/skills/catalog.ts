import type OpenAI from 'openai';
import {
  InMemorySkillRegistry,
  SkillsToolRegistry,
  registerFoundationSkills,
  type AuthzContext,
  type ResolvedTool,
  type SearchSkillsInput,
  type SkillSearchHit,
} from '../../../../packages/skills/src/index';

const foundationSkillRegistry = new InMemorySkillRegistry();
registerFoundationSkills(foundationSkillRegistry);

export const foundationSkillsToolRegistry = new SkillsToolRegistry(
  foundationSkillRegistry,
);

export interface ResolveFoundationChatToolsInput {
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceType?: string | null;
  readonly currentUserRole?: string | null;
  readonly allowedTools: Iterable<string>;
}

export function buildFoundationSkillsAuthz(
  input: ResolveFoundationChatToolsInput,
): AuthzContext {
  return {
    tenant: {
      tenantId: input.workspaceId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      workspaceType: input.workspaceType ?? undefined,
    },
    roles: input.currentUserRole ? [input.currentUserRole] : [],
    permissions: [],
    permissionMode: 'allowlist',
    allowedTools: Array.from(new Set(input.allowedTools)),
  };
}

export function resolvedToolToOpenAIChatTool(
  tool: ResolvedTool,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

export function resolveFoundationChatTools(
  input: ResolveFoundationChatToolsInput,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const authz = buildFoundationSkillsAuthz(input);
  return foundationSkillsToolRegistry
    .resolveTools(authz)
    .map((tool) => resolvedToolToOpenAIChatTool(tool));
}

export function executeFoundationSearchSkills(input: {
  readonly authz: ResolveFoundationChatToolsInput;
  readonly payload: SearchSkillsInput;
}): ReadonlyArray<SkillSearchHit> {
  return foundationSkillsToolRegistry.executeSearchSkills(
    buildFoundationSkillsAuthz(input.authz),
    input.payload,
  );
}

