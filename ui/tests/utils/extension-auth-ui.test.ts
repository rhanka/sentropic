import { describe, expect, it } from 'vitest';

import {
  resolveExtensionAuthUiState,
  resolveExtensionChatGateState,
} from '../../src/lib/utils/extension-auth-ui';

describe('extension auth UI state', () => {
  it('requires a session token only for VSCode token-bootstrap hosts', () => {
    expect(
      resolveExtensionAuthUiState({
        usesTokenBootstrap: true,
        isExtensionConfigAvailable: true,
        sessionToken: '',
        connected: false,
      }),
    ).toMatchObject({
      extensionAuthRequired: true,
      showSessionTokenField: true,
      showProviderManagedHint: true,
      connectLabelKey: 'chat.extension.auth.connectToken',
      logoutLabelKey: 'chat.extension.auth.logoutToken',
    });

    expect(
      resolveExtensionAuthUiState({
        usesTokenBootstrap: false,
        isExtensionConfigAvailable: true,
        sessionToken: '',
        connected: false,
      }),
    ).toMatchObject({
      extensionAuthRequired: false,
      showSessionTokenField: false,
      showProviderManagedHint: false,
      connectLabelKey: 'chat.extension.auth.connect',
      logoutLabelKey: 'chat.extension.auth.logout',
    });
  });

  it('shows the Chrome open-login affordance only when disconnected with a login URL', () => {
    expect(
      resolveExtensionAuthUiState({
        usesTokenBootstrap: false,
        isExtensionConfigAvailable: true,
        sessionToken: '',
        connected: false,
        loginUrl: 'https://top-ai-ideas.local/auth/login',
      }).showOpenLogin,
    ).toBe(true);

    expect(
      resolveExtensionAuthUiState({
        usesTokenBootstrap: false,
        isExtensionConfigAvailable: true,
        sessionToken: '',
        connected: true,
        loginUrl: 'https://top-ai-ideas.local/auth/login',
      }).showOpenLogin,
    ).toBe(false);

    expect(
      resolveExtensionAuthUiState({
        usesTokenBootstrap: true,
        isExtensionConfigAvailable: true,
        sessionToken: '',
        connected: false,
        loginUrl: 'https://top-ai-ideas.local/auth/login',
      }).showOpenLogin,
    ).toBe(false);
  });

  it('blocks the chat panel until extension auth is known and connected', () => {
    expect(
      resolveExtensionChatGateState({
        isExtensionConfigAvailable: true,
        authStatusLoaded: false,
        connected: false,
        isVisible: true,
      }),
    ).toEqual({
      blockChatPanel: true,
      showLoadingState: true,
      showAuthState: false,
      shouldAutoOpenSettings: false,
    });

    expect(
      resolveExtensionChatGateState({
        isExtensionConfigAvailable: true,
        authStatusLoaded: true,
        connected: false,
        isVisible: true,
      }),
    ).toEqual({
      blockChatPanel: true,
      showLoadingState: false,
      showAuthState: true,
      shouldAutoOpenSettings: true,
    });

    expect(
      resolveExtensionChatGateState({
        isExtensionConfigAvailable: true,
        authStatusLoaded: true,
        connected: true,
        isVisible: true,
      }),
    ).toEqual({
      blockChatPanel: false,
      showLoadingState: false,
      showAuthState: false,
      shouldAutoOpenSettings: false,
    });
  });
});
