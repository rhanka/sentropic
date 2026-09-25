import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const source = readFileSync(resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte'), 'utf8');

describe('ChatWidget host content gate', () => {
  it('keeps loading, auth and workspace actions before the single ready invocation', () => {
    const gate = source.slice(source.indexOf('{#snippet renderContentGateHost('), source.indexOf('{#snippet renderAppDockContent('));
    const loading = gate.indexOf('{#if extensionChatGateState.showLoadingState}');
    const auth = gate.indexOf('{:else if extensionChatGateState.showAuthState}');
    const onboarding = gate.indexOf('{:else if extensionWorkspaceOnboardingRequired}');
    const ready = gate.indexOf('{@render renderReady()}');
    expect(loading).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(loading);
    expect(onboarding).toBeGreaterThan(auth);
    expect(ready).toBeGreaterThan(onboarding);
    expect(gate.match(/\{@render renderReady\(\)\}/g)).toHaveLength(1);
    expect(gate.slice(loading, auth)).toContain('extensionAuthStatus');
    expect(gate.slice(auth, onboarding)).toContain('on:mousedown|stopPropagation={openExtensionSettingsMenu}');
    expect(gate.slice(auth, onboarding)).toContain('on:click|stopPropagation={openExtensionSettingsMenu}');
    const workspace = gate.slice(onboarding, ready);
    expect(workspace).toContain('createExtensionCodeWorkspace()');
    expect(workspace).toContain('extensionConfigForm.codeWorkspaces.length > 0');
    expect(workspace).toContain("extensionSettingsTab = 'workspace'");
    expect(workspace).toContain('showExtensionConfigMenu = true');
    expect(workspace).toContain('deferExtensionWorkspaceMapping()');
    expect(workspace.match(/disabled=\{extensionWorkspaceOnboardingBusy\}/g)).toHaveLength(3);
    expect(workspace).toContain('extensionWorkspaceOnboardingError');
    expect(source).toContain('{#if !extensionChatGateState.blockChatPanel}');
    expect(source).toContain('renderContentGate={renderContentGateHost}');
  });
});
