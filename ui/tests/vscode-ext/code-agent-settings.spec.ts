import { describe, expect, it } from 'vitest';

import en from '../../src/locales/en.json';
import fr from '../../src/locales/fr.json';

describe('vscode code-agent settings i18n contract', () => {
  it('exposes split settings tab labels', () => {
    expect(en.chat.extension.settingsTabs.server).toBeTruthy();
    expect(en.chat.extension.settingsTabs.workspace).toBeTruthy();
    expect(en.chat.extension.settingsTabs.tools).toBeTruthy();

    expect(fr.chat.extension.settingsTabs.server).toBeTruthy();
    expect(fr.chat.extension.settingsTabs.workspace).toBeTruthy();
    expect(fr.chat.extension.settingsTabs.tools).toBeTruthy();
  });

  it('exposes required EN labels for code-agent settings', () => {
    const codeAgent = en.chat.extension.codeAgent;
    expect(codeAgent.title).toBeTruthy();
    expect(codeAgent.effectivePromptSource).toBeTruthy();
    expect(codeAgent.sourceWorkspace).toBeTruthy();
    expect(codeAgent.sourceServer).toBeTruthy();
    expect(codeAgent.sourceDefault).toBeTruthy();
    expect(codeAgent.effectivePrompt).toBeTruthy();
    expect(codeAgent.workspacePromptHint).toContain('{scope}');
    expect(codeAgent.createWorkspaceOverride).toBeTruthy();
    expect(codeAgent.resetWorkspaceOverride).toBeTruthy();
    expect(codeAgent.workspaceOverrideActive).toBeTruthy();
    expect(codeAgent.resetPending).toBeTruthy();
    expect(codeAgent.instructionPatterns).toBeTruthy();
    expect(codeAgent.instructionPatternsHint).toBeTruthy();
  });

  it('exposes required FR labels for code-agent settings', () => {
    const codeAgent = fr.chat.extension.codeAgent;
    expect(codeAgent.title).toBeTruthy();
    expect(codeAgent.effectivePromptSource).toBeTruthy();
    expect(codeAgent.sourceWorkspace).toBeTruthy();
    expect(codeAgent.sourceServer).toBeTruthy();
    expect(codeAgent.sourceDefault).toBeTruthy();
    expect(codeAgent.effectivePrompt).toBeTruthy();
    expect(codeAgent.workspacePromptHint).toContain('{scope}');
    expect(codeAgent.createWorkspaceOverride).toBeTruthy();
    expect(codeAgent.resetWorkspaceOverride).toBeTruthy();
    expect(codeAgent.workspaceOverrideActive).toBeTruthy();
    expect(codeAgent.resetPending).toBeTruthy();
    expect(codeAgent.instructionPatterns).toBeTruthy();
    expect(codeAgent.instructionPatternsHint).toBeTruthy();
  });

  it('exposes workspace onboarding labels for EN and FR', () => {
    expect(en.chat.extension.workspaceFlow.onboardingTitle).toBeTruthy();
    expect(en.chat.extension.workspaceFlow.onboardingDescription).toBeTruthy();
    expect(en.chat.extension.workspaceFlow.createWorkspace).toBeTruthy();
    expect(en.chat.extension.workspaceFlow.useExisting).toBeTruthy();
    expect(en.chat.extension.workspaceFlow.notNow).toBeTruthy();

    expect(fr.chat.extension.workspaceFlow.onboardingTitle).toBeTruthy();
    expect(fr.chat.extension.workspaceFlow.onboardingDescription).toBeTruthy();
    expect(fr.chat.extension.workspaceFlow.createWorkspace).toBeTruthy();
    expect(fr.chat.extension.workspaceFlow.useExisting).toBeTruthy();
    expect(fr.chat.extension.workspaceFlow.notNow).toBeTruthy();
  });
});
