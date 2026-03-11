export type ExtensionAuthUiState = {
  extensionAuthRequired: boolean;
  showSessionTokenField: boolean;
  showProviderManagedHint: boolean;
  showOpenLogin: boolean;
  connectLabelKey:
    | 'chat.extension.auth.connect'
    | 'chat.extension.auth.connectToken';
  logoutLabelKey:
    | 'chat.extension.auth.logout'
    | 'chat.extension.auth.logoutToken';
};

export const resolveExtensionAuthUiState = (input: {
  usesTokenBootstrap: boolean;
  isExtensionConfigAvailable: boolean;
  sessionToken: string;
  connected: boolean;
  loginUrl?: string | null;
}): ExtensionAuthUiState => {
  const sessionToken = input.sessionToken.trim();
  const loginUrl = String(input.loginUrl ?? '').trim();

  return {
    extensionAuthRequired:
      input.isExtensionConfigAvailable &&
      input.usesTokenBootstrap &&
      sessionToken.length === 0,
    showSessionTokenField: input.usesTokenBootstrap,
    showProviderManagedHint: input.usesTokenBootstrap,
    showOpenLogin:
      !input.usesTokenBootstrap && !input.connected && loginUrl.length > 0,
    connectLabelKey: input.usesTokenBootstrap
      ? 'chat.extension.auth.connectToken'
      : 'chat.extension.auth.connect',
    logoutLabelKey: input.usesTokenBootstrap
      ? 'chat.extension.auth.logoutToken'
      : 'chat.extension.auth.logout',
  };
};
