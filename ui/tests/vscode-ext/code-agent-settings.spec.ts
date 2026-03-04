import { describe, expect, it } from 'vitest';

import en from '../../src/locales/en.json';
import fr from '../../src/locales/fr.json';

describe('vscode code-agent settings i18n contract', () => {
  it('exposes required EN labels for code-agent settings', () => {
    const codeAgent = en.chat.extension.codeAgent;
    expect(codeAgent.title).toBeTruthy();
    expect(codeAgent.globalPrompt).toBeTruthy();
    expect(codeAgent.workspacePrompt).toBeTruthy();
    expect(codeAgent.workspacePromptHint).toContain('{scope}');
    expect(codeAgent.instructionPatterns).toBeTruthy();
    expect(codeAgent.instructionPatternsHint).toBeTruthy();
  });

  it('exposes required FR labels for code-agent settings', () => {
    const codeAgent = fr.chat.extension.codeAgent;
    expect(codeAgent.title).toBeTruthy();
    expect(codeAgent.globalPrompt).toBeTruthy();
    expect(codeAgent.workspacePrompt).toBeTruthy();
    expect(codeAgent.workspacePromptHint).toContain('{scope}');
    expect(codeAgent.instructionPatterns).toBeTruthy();
    expect(codeAgent.instructionPatternsHint).toBeTruthy();
  });
});
