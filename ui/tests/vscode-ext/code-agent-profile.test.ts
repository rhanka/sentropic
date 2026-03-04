import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VSCODE_CODE_AGENT_PROMPT,
  resolveCodeAgentPromptProfile,
} from '../../src/lib/vscode/code-agent-profile';

describe('vscode code-agent profile resolver', () => {
  it('falls back to default prompt when overrides are empty', () => {
    const resolved = resolveCodeAgentPromptProfile({
      workspaceOverride: '',
      serverOverride: '',
      defaultPrompt: '',
    });

    expect(resolved.source).toBe('default');
    expect(resolved.effectivePrompt).toBe(DEFAULT_VSCODE_CODE_AGENT_PROMPT);
    expect(resolved.inheritedPrompt).toBe(DEFAULT_VSCODE_CODE_AGENT_PROMPT);
  });

  it('prefers server override when workspace override is empty', () => {
    const resolved = resolveCodeAgentPromptProfile({
      workspaceOverride: '',
      serverOverride: 'server prompt',
      defaultPrompt: 'default prompt',
    });

    expect(resolved.source).toBe('server');
    expect(resolved.effectivePrompt).toBe('server prompt');
    expect(resolved.inheritedPrompt).toBe('server prompt');
  });

  it('prefers workspace override over server override', () => {
    const resolved = resolveCodeAgentPromptProfile({
      workspaceOverride: 'workspace prompt',
      serverOverride: 'server prompt',
      defaultPrompt: 'default prompt',
    });

    expect(resolved.source).toBe('workspace');
    expect(resolved.effectivePrompt).toBe('workspace prompt');
    expect(resolved.inheritedPrompt).toBe('server prompt');
  });
});
