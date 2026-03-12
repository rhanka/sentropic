import { describe, expect, it } from 'vitest';

import { resolveExtensionAuthUiState } from '../../src/lib/utils/extension-auth-ui';

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
});
