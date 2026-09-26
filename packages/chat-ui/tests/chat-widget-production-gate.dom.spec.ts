import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Host from './fixtures/ProductionWidgetHarness.svelte';

afterEach(cleanup);
const gate = (showLoadingState = false, showAuthState = false, blockChatPanel = false) =>
  ({ showLoadingState, showAuthState, blockChatPanel });
const button = (key: string) => screen.getByRole('button', { name: `label:chat.extension.${key}` });

describe('production host content gate', () => {
  it('blocks ready in precedence order and executes both settings events without bubbling', async () => {
    const mount = vi.fn(), destroy = vi.fn(), openExtensionSettingsMenu = vi.fn();
    const { container, rerender } = render(Host, {
      mount, destroy, openExtensionSettingsMenu, extensionChatGateState: gate(true, true),
      extensionWorkspaceOnboardingRequired: true,
    });
    const assertBlocked = () => {
      expect(screen.queryByLabelText('Composer')).toBeNull();
      expect(mount).not.toHaveBeenCalled();
      expect(destroy).not.toHaveBeenCalled();
      expect(screen.getByText('Settings')).not.toBeNull();
      expect(container.querySelectorAll('[data-chat-widget-tab-bar]')).toHaveLength(1);
    };
    expect(screen.getByText('label:common.loading')).not.toBeNull();
    expect(screen.getByText('Auth pending')).not.toBeNull();
    expect(screen.queryByText('label:chat.extension.authRequired.title')).toBeNull();
    assertBlocked();
    await rerender({ extensionChatGateState: gate(false, true) });
    expect(screen.getByText('label:chat.extension.authRequired.title')).not.toBeNull();
    expect(screen.queryByText('label:chat.extension.workspaceFlow.onboardingTitle')).toBeNull();
    assertBlocked();
    const bubble = vi.fn();
    container.addEventListener('mousedown', bubble);
    container.addEventListener('click', bubble);
    await fireEvent.mouseDown(button('authRequired.openSettings'));
    expect(openExtensionSettingsMenu).toHaveBeenCalledTimes(1);
    expect(openExtensionSettingsMenu.mock.calls[0][0].type).toBe('mousedown');
    await fireEvent.click(button('authRequired.openSettings'));
    expect(openExtensionSettingsMenu).toHaveBeenCalledTimes(2);
    expect(openExtensionSettingsMenu.mock.calls[1][0].type).toBe('click');
    expect(bubble).not.toHaveBeenCalled();
    await rerender({ extensionChatGateState: gate() });
    expect(screen.getByText('label:chat.extension.workspaceFlow.onboardingTitle')).not.toBeNull();
    assertBlocked();
    await rerender({ extensionWorkspaceOnboardingRequired: false });
    expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    await rerender({ extensionChatGateState: gate(false, false, true) });
    expect(screen.queryByLabelText('Composer')).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
    await rerender({ extensionChatGateState: gate() });
    expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(2);
    for (const props of [
      { extensionChatGateState: gate(true) },
      { extensionChatGateState: gate(false, true) },
      { extensionChatGateState: gate(), extensionWorkspaceOnboardingRequired: true },
    ]) {
      const mounts = mount.mock.calls.length;
      await rerender(props);
      expect(screen.queryByLabelText('Composer')).toBeNull();
      expect(destroy).toHaveBeenCalledTimes(mounts);
      await rerender({ extensionChatGateState: gate(), extensionWorkspaceOnboardingRequired: false });
      expect(screen.getAllByLabelText('Composer')).toHaveLength(1);
      expect(mount).toHaveBeenCalledTimes(mounts + 1);
      expect(destroy).toHaveBeenCalledTimes(mounts);
    }
  });

  it('executes available onboarding actions and disables all three while busy, retaining errors', async () => {
    const createExtensionCodeWorkspace = vi.fn(), deferExtensionWorkspaceMapping = vi.fn();
    const { rerender } = render(Host, {
      extensionWorkspaceOnboardingRequired: true, createExtensionCodeWorkspace, deferExtensionWorkspaceMapping,
    });
    expect(screen.queryByText('label:chat.extension.workspaceFlow.useExisting')).toBeNull();
    expect(screen.queryByText('label:chat.extension.workspaceFlow.notNow')).toBeNull();
    await fireEvent.click(button('workspaceFlow.createWorkspace'));
    expect(createExtensionCodeWorkspace.mock.calls).toEqual([[]]);
    await rerender({ extensionConfigForm: { codeWorkspaces: ['workspace-1'] } });
    await fireEvent.click(button('workspaceFlow.useExisting'));
    expect(screen.getByLabelText('Settings state').textContent).toBe('workspace:true');
    await fireEvent.click(button('workspaceFlow.notNow'));
    expect(deferExtensionWorkspaceMapping.mock.calls).toEqual([[]]);
    await rerender({ extensionWorkspaceOnboardingBusy: true, extensionWorkspaceOnboardingError: 'Creation failed',
      extensionSettingsTab: 'general', showExtensionConfigMenu: false });
    for (const action of ['createWorkspace', 'useExisting', 'notNow']) {
      const control = button(`workspaceFlow.${action}`) as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      control.click();
    }
    expect(createExtensionCodeWorkspace.mock.calls).toEqual([[]]);
    expect(deferExtensionWorkspaceMapping.mock.calls).toEqual([[]]);
    expect(screen.getByLabelText('Settings state').textContent).toBe('general:false');
    expect(screen.getByText('Creation failed')).not.toBeNull();
    expect(screen.queryByLabelText('Composer')).toBeNull();
    await rerender({ extensionWorkspaceOnboardingBusy: false, extensionWorkspaceOnboardingError: '' });
    for (const action of ['createWorkspace', 'useExisting', 'notNow']) {
      expect((button(`workspaceFlow.${action}`) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.queryByText('Creation failed')).toBeNull();
  });
});
