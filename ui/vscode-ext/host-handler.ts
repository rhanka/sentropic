export type TopAiRuntimeConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  wsBaseUrl: string;
  sessionToken: string;
  codexSignInUrl: string;
};

export type TopAiVsCodeCommand =
  | 'runtime.config.get';

export type TopAiVsCodeRequestPayloadMap = {
  'runtime.config.get': undefined;
};

export type TopAiVsCodeRequestHandlerDeps = {
  getRuntimeConfig: () => TopAiRuntimeConfig;
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

    throw new Error(`Unsupported command: ${command}`);
  };
