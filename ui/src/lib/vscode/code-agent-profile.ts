export type CodeAgentPromptSource = 'workspace' | 'server' | 'default';

export type ResolvedCodeAgentPromptProfile = {
  source: CodeAgentPromptSource;
  effectivePrompt: string;
  inheritedPrompt: string;
};

const normalizePrompt = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const resolveCodeAgentPromptProfile = (input: {
  workspaceOverride?: unknown;
  serverOverride?: unknown;
  defaultPrompt?: unknown;
}): ResolvedCodeAgentPromptProfile => {
  const workspaceOverride = normalizePrompt(input.workspaceOverride);
  const serverOverride = normalizePrompt(input.serverOverride);
  const defaultPrompt = normalizePrompt(input.defaultPrompt);

  if (workspaceOverride.length > 0) {
    return {
      source: 'workspace',
      effectivePrompt: workspaceOverride,
      inheritedPrompt: serverOverride || defaultPrompt,
    };
  }
  if (serverOverride.length > 0) {
    return {
      source: 'server',
      effectivePrompt: serverOverride,
      inheritedPrompt: serverOverride,
    };
  }
  return {
    source: 'default',
    effectivePrompt: defaultPrompt,
    inheritedPrompt: defaultPrompt,
  };
};
