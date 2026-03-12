import { describe, expect, it } from 'vitest';

import { resolveCodeAgentPromptProfile } from '../../src/lib/vscode/code-agent-profile';

describe('vscode code-agent profile resolver', () => {
  it('uses the instance-managed default prompt when overrides are empty', () => {
    const resolved = resolveCodeAgentPromptProfile({
      workspaceOverride: '',
      serverOverride: '',
      defaultPrompt: 'INSTANCE_MANAGED_DEFAULT_PROMPT',
    });

    expect(resolved.source).toBe('default');
    expect(resolved.effectivePrompt).toBe('INSTANCE_MANAGED_DEFAULT_PROMPT');
    expect(resolved.inheritedPrompt).toBe('INSTANCE_MANAGED_DEFAULT_PROMPT');
  });

  it('does not reintroduce a local fallback prompt when default is unavailable', () => {
    const resolved = resolveCodeAgentPromptProfile({
      workspaceOverride: '',
      serverOverride: '',
      defaultPrompt: '',
    });

    expect(resolved.source).toBe('default');
    expect(resolved.effectivePrompt).toBe('');
    expect(resolved.inheritedPrompt).toBe('');
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
