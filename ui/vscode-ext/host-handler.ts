export type TopAiRuntimeConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  sessionToken: string;
  codexSignInUrl: string;
};

export type TopAiVsCodeCommand =
  | 'runtime.config.get'
  | 'auth.codex.status'
  | 'auth.codex.signIn';

export type TopAiVsCodeRequestPayloadMap = {
  'runtime.config.get': undefined;
  'auth.codex.status': undefined;
  'auth.codex.signIn': undefined;
};

export type TopAiVsCodeRequestHandlerDeps = {
  getRuntimeConfig: () => TopAiRuntimeConfig;
  openExternal: (url: string) => Promise<boolean>;
  getCodexConnected: () => boolean;
  setCodexConnected: (connected: boolean) => Promise<void>;
};

export const createTopAiVsCodeRequestHandler =
  (deps: TopAiVsCodeRequestHandlerDeps) =>
  async <T extends TopAiVsCodeCommand>(
    command: T,
    _payload?: TopAiVsCodeRequestPayloadMap[T],
  ): Promise<unknown> => {
    if (command === 'runtime.config.get') {
      return deps.getRuntimeConfig();
    }

    if (command === 'auth.codex.status') {
      const connected = deps.getCodexConnected();
      return {
        connected,
        accountLabel: null,
        reason: connected ? 'Codex sign-in initiated in this extension profile.' : 'not_connected',
      };
    }

    if (command === 'auth.codex.signIn') {
      const config = deps.getRuntimeConfig();
      const opened = await deps.openExternal(config.codexSignInUrl);
      if (opened) {
        await deps.setCodexConnected(true);
      }
      return { opened, url: config.codexSignInUrl };
    }

    throw new Error(`Unsupported command: ${command}`);
  };
