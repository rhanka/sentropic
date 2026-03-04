export type TopAiRuntimeConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  wsBaseUrl: string;
  sessionToken: string;
  codexSignInUrl: string;
  codeAgentPromptGlobal: string;
  codeAgentPromptWorkspace: string;
  instructionIncludePatterns: string[];
  workspaceScopeKey: string;
  workspaceScopeLabel: string;
};

export type TopAiVsCodeCommand =
  | 'runtime.config.get'
  | 'runtime.auth.validate'
  | 'runtime.http.request';

export type TopAiVsCodeRequestPayloadMap = {
  'runtime.config.get': undefined;
  'runtime.auth.validate': undefined;
  'runtime.http.request': {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  };
};

export type RuntimeHttpRequestResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
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
  performRuntimeHttpRequest?: (
    payload: TopAiVsCodeRequestPayloadMap['runtime.http.request'],
  ) => RuntimeHttpRequestResult | Promise<RuntimeHttpRequestResult>;
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

    if (command === 'runtime.http.request') {
      if (!deps.performRuntimeHttpRequest) {
        throw new Error(`Unsupported command: ${command}`);
      }
      return await deps.performRuntimeHttpRequest(
        (_payload ?? {}) as TopAiVsCodeRequestPayloadMap['runtime.http.request'],
      );
    }

    throw new Error(`Unsupported command: ${command}`);
  };
