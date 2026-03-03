export type TopAiRuntimeConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  wsBaseUrl: string;
  sessionToken: string;
  codexSignInUrl: string;
};

export type TopAiVsCodeCommand =
  | 'runtime.config.get'
  | 'runtime.auth.validate';

export type TopAiVsCodeRequestPayloadMap = {
  'runtime.config.get': undefined;
  'runtime.auth.validate': undefined;
};

export type TopAiVsCodeRequestHandlerDeps = {
  getRuntimeConfig: () => TopAiRuntimeConfig | Promise<TopAiRuntimeConfig>;
  validateRuntimeAuth?: () =>
    | {
        connected: boolean;
        reason: string;
        user?: {
          id: string;
          email: string | null;
          displayName: string | null;
          role: string;
        } | null;
      }
    | Promise<{
        connected: boolean;
        reason: string;
        user?: {
          id: string;
          email: string | null;
          displayName: string | null;
          role: string;
        } | null;
      }>;
};

export const createTopAiVsCodeRequestHandler =
  (deps: TopAiVsCodeRequestHandlerDeps) =>
  async <T extends TopAiVsCodeCommand>(
    command: T,
    _payload?: TopAiVsCodeRequestPayloadMap[T],
  ): Promise<unknown> => {
    if (command === 'runtime.config.get') {
      return await deps.getRuntimeConfig();
    }

    if (command === 'runtime.auth.validate') {
      if (!deps.validateRuntimeAuth) {
        throw new Error(`Unsupported command: ${command}`);
      }
      return await deps.validateRuntimeAuth();
    }

    throw new Error(`Unsupported command: ${command}`);
  };
