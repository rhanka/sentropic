import * as vscode from 'vscode';
import {
  createTopAiVsCodeRequestHandler,
  type RuntimeHttpRequestResult,
  type TopAiRuntimeConfig,
  type TopAiVsCodeCommand,
} from './host-handler';
import { createVsCodeLocalToolsRuntime } from './local-tools';

const COMMAND_OPEN_PANEL = 'topai.openPanel';
const VIEW_ID = 'topai.chatView';
const VIEW_CONTAINER_ID = 'topai';
const SECRET_SESSION_TOKEN_KEY = 'topai.sessionToken';
const STATE_KEY_RUNTIME_CONFIG = 'topai.runtimeConfig';

declare const __TOPAI_DEFAULT_API_BASE_URL__: string | undefined;
declare const __TOPAI_DEFAULT_APP_BASE_URL__: string | undefined;

const DEFAULT_API_BASE_URL =
  __TOPAI_DEFAULT_API_BASE_URL__ || 'http://localhost:8787/api/v1';
const DEFAULT_APP_BASE_URL =
  __TOPAI_DEFAULT_APP_BASE_URL__ || 'http://localhost:5173';

const defaultConfig: TopAiRuntimeConfig = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  appBaseUrl: DEFAULT_APP_BASE_URL,
  wsBaseUrl: '',
  sessionToken: '',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
};

type RuntimeConfigPatchPayload = {
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  sessionToken?: string;
};

const normalizeConfigString = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const readRuntimeConfig = async (
  context: vscode.ExtensionContext,
): Promise<TopAiRuntimeConfig> => {
  const config = vscode.workspace.getConfiguration('topai');
  const persisted = context.globalState.get<RuntimeConfigPatchPayload>(
    STATE_KEY_RUNTIME_CONFIG,
    {},
  );
  const apiBaseUrl = normalizeConfigString(
    persisted.apiBaseUrl ??
      config.get<string>('apiBaseUrl', defaultConfig.apiBaseUrl),
    defaultConfig.apiBaseUrl,
  );
  const appBaseUrl = normalizeConfigString(
    persisted.appBaseUrl ??
      config.get<string>('appBaseUrl', defaultConfig.appBaseUrl),
    defaultConfig.appBaseUrl,
  );
  const wsBaseUrl = normalizeConfigString(
    persisted.wsBaseUrl ??
      config.get<string>('wsBaseUrl', defaultConfig.wsBaseUrl),
    defaultConfig.wsBaseUrl,
  );

  const secretToken = await context.secrets.get(SECRET_SESSION_TOKEN_KEY);
  const fallbackSettingToken = normalizeConfigString(
    config.get<string>('sessionToken', ''),
    '',
  );

  return {
    apiBaseUrl,
    appBaseUrl,
    wsBaseUrl,
    sessionToken: normalizeConfigString(secretToken, fallbackSettingToken),
    codexSignInUrl: defaultConfig.codexSignInUrl,
  };
};

const saveRuntimeConfigPatch = async (
  context: vscode.ExtensionContext,
  payload: RuntimeConfigPatchPayload,
): Promise<TopAiRuntimeConfig> => {
  const current = context.globalState.get<RuntimeConfigPatchPayload>(
    STATE_KEY_RUNTIME_CONFIG,
    {},
  );
  const next: RuntimeConfigPatchPayload = {
    ...current,
  };

  if (typeof payload.apiBaseUrl === 'string') {
    next.apiBaseUrl = payload.apiBaseUrl.trim();
  }
  if (typeof payload.appBaseUrl === 'string') {
    next.appBaseUrl = payload.appBaseUrl.trim();
  }
  if (typeof payload.wsBaseUrl === 'string') {
    next.wsBaseUrl = payload.wsBaseUrl.trim();
  }

  if (typeof payload.sessionToken === 'string') {
    const token = payload.sessionToken.trim();
    if (token.length > 0) {
      await context.secrets.store(SECRET_SESSION_TOKEN_KEY, token);
    } else {
      await context.secrets.delete(SECRET_SESSION_TOKEN_KEY);
    }
  }

  await context.globalState.update(STATE_KEY_RUNTIME_CONFIG, next);
  return readRuntimeConfig(context);
};

const testApiConnectivity = async (
  apiBaseUrl: string,
  sessionToken: string,
): Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}> => {
  const normalizedBase = apiBaseUrl.replace(/\/$/, '');
  const healthUrl = `${normalizedBase}/health`;

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: response.ok
        ? undefined
        : `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const performRuntimeHttpRequest = async (
  runtimeConfig: TopAiRuntimeConfig,
  payload: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  },
): Promise<RuntimeHttpRequestResult> => {
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!url) {
    throw new Error('runtime.http.request requires a non-empty url.');
  }

  const method = typeof payload.method === 'string' && payload.method.trim()
    ? payload.method.trim().toUpperCase()
    : 'GET';
  const targetUrl = new URL(url);
  const apiBaseOrigin = (() => {
    try {
      return new URL(runtimeConfig.apiBaseUrl).origin;
    } catch {
      return '';
    }
  })();

  if (apiBaseOrigin && targetUrl.origin !== apiBaseOrigin) {
    throw new Error('runtime.http.request rejects cross-origin targets.');
  }

  const requestHeaders: Record<string, string> = {
    ...(payload.headers ?? {}),
  };

  if (runtimeConfig.sessionToken.trim()) {
    requestHeaders.Authorization = `Bearer ${runtimeConfig.sessionToken.trim()}`;
  }

  const response = await fetch(targetUrl.toString(), {
    method,
    headers: requestHeaders,
    body:
      typeof payload.bodyText === 'string' && method !== 'GET' && method !== 'HEAD'
        ? payload.bodyText
        : undefined,
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText: await response.text(),
  };
};

const validateTokenSession = async (
  apiBaseUrl: string,
  sessionToken: string,
): Promise<{
  connected: boolean;
  reason: string;
  user?: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: string;
  } | null;
}> => {
  if (!sessionToken.trim()) {
    return {
      connected: false,
      reason: 'TOKEN_REQUIRED',
      user: null,
    };
  }

  const normalizedBase = apiBaseUrl.replace(/\/$/, '');
  const sessionUrl = `${normalizedBase}/auth/session`;

  try {
    const response = await fetch(sessionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      return {
        connected: false,
        reason: `HTTP_${response.status}`,
        user: null,
      };
    }

    const payload = (await response.json()) as {
      userId?: string;
      email?: string | null;
      displayName?: string | null;
      role?: string;
    };

    if (!payload?.userId) {
      return {
        connected: false,
        reason: 'INVALID_SESSION_PAYLOAD',
        user: null,
      };
    }

    return {
      connected: true,
      reason: 'connected',
      user: {
        id: payload.userId,
        email: payload.email ?? null,
        displayName: payload.displayName ?? null,
        role: payload.role ?? 'editor',
      },
    };
  } catch (error) {
    return {
      connected: false,
      reason: error instanceof Error ? error.message : String(error),
      user: null,
    };
  }
};

const createWebviewHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  config: TopAiRuntimeConfig,
): string => {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview-entry.js'),
  );
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const runtimeConfigJson = JSON.stringify(config).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: http: wss: ws:;" />
    <title>Top AI Ideas</title>
  </head>
  <body style="margin: 0; padding: 0; overflow: hidden;">
    <div id="topai-vscode-root" style="height: 100vh;"></div>
    <script nonce="${nonce}">
      window.__TOPAI_VSCODE_RUNTIME__ = ${runtimeConfigJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
};

class TopAiChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private revealRequested = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runtimeHandler: ReturnType<typeof createTopAiVsCodeRequestHandler>,
    private readonly localToolsRuntime: ReturnType<typeof createVsCodeLocalToolsRuntime>,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    const runtimeConfig = await readRuntimeConfig(this.context);
    webviewView.webview.html = createWebviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      runtimeConfig,
    );

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(message);
    });

    if (this.revealRequested) {
      this.revealRequested = false;
      const maybeShow = (webviewView as vscode.WebviewView & {
        show?: (preserveFocus?: boolean) => void;
      }).show;
      maybeShow?.call(webviewView, true);
    }
  }

  async reveal(): Promise<void> {
    this.revealRequested = true;
    await vscode.commands.executeCommand(
      `workbench.view.extension.${VIEW_CONTAINER_ID}`,
    );
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);

    if (this.view) {
      const maybeShow = (this.view as vscode.WebviewView & {
        show?: (preserveFocus?: boolean) => void;
      }).show;
      maybeShow?.call(this.view, true);
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const runtimeConfig = await readRuntimeConfig(this.context);
    this.view.webview.html = createWebviewHtml(
      this.view.webview,
      this.context.extensionUri,
      runtimeConfig,
    );
  }

  private async handleWebviewMessage(rawMessage: unknown): Promise<void> {
    if (!this.view || !rawMessage || typeof rawMessage !== 'object') return;

    const payload = rawMessage as Record<string, unknown>;
    if (payload.source !== 'topai-vscode-webview') return;
    if (payload.type !== 'request') return;

    const requestId =
      typeof payload.requestId === 'string' ? payload.requestId : '';
    const command =
      typeof payload.command === 'string' ? payload.command.trim() : '';
    if (!requestId || !command) return;

    const respond = (ok: boolean, resultPayload?: unknown, error?: string): void => {
      this.view?.webview.postMessage({
        source: 'topai-vscode-host',
        type: 'response',
        command,
        requestId,
        ok,
        payload: resultPayload,
        error,
      });
    };

    try {
      if (command === 'runtime.config.get') {
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.config.set') {
        const patch =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as RuntimeConfigPatchPayload)
            : {};
        const updatedConfig = await saveRuntimeConfigPatch(this.context, patch);
        respond(true, updatedConfig);
        return;
      }

      if (command === 'runtime.config.test') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { apiBaseUrl?: unknown })
            : {};
        const targetApiBaseUrl =
          typeof requestPayload.apiBaseUrl === 'string' &&
          requestPayload.apiBaseUrl.trim().length > 0
            ? requestPayload.apiBaseUrl.trim()
            : runtimeConfig.apiBaseUrl;

        const result = await testApiConnectivity(
          targetApiBaseUrl,
          runtimeConfig.sessionToken,
        );
        respond(true, result);
        return;
      }

      if (command === 'runtime.auth.validate') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const result = await validateTokenSession(
          runtimeConfig.apiBaseUrl,
          runtimeConfig.sessionToken,
        );
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.execute') {
        const result = await this.localToolsRuntime.execute(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permission_decide') {
        const result = await this.localToolsRuntime.decide(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.list') {
        const result = await this.localToolsRuntime.listPolicies();
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.upsert') {
        const result = await this.localToolsRuntime.upsertPolicy(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.delete') {
        const result = await this.localToolsRuntime.deletePolicy(payload.payload);
        respond(true, result);
        return;
      }

      const result = await this.runtimeHandler(
        command as TopAiVsCodeCommand,
        payload.payload,
      );
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, message);
    }
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  const localToolsRuntime = createVsCodeLocalToolsRuntime(context, {
    getWorkspaceRoot: () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      return folder?.uri?.fsPath ?? null;
    },
  });
  const runtimeHandler = createTopAiVsCodeRequestHandler({
    getRuntimeConfig: async () => readRuntimeConfig(context),
    validateRuntimeAuth: async () => {
      const runtimeConfig = await readRuntimeConfig(context);
      return validateTokenSession(
        runtimeConfig.apiBaseUrl,
        runtimeConfig.sessionToken,
      );
    },
    performRuntimeHttpRequest: async (payload) => {
      const runtimeConfig = await readRuntimeConfig(context);
      return performRuntimeHttpRequest(runtimeConfig, payload);
    },
  });

  const provider = new TopAiChatViewProvider(
    context,
    runtimeHandler,
    localToolsRuntime,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_PANEL, () => {
      void provider.reveal();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('topai')) return;
      void provider.refresh();
    }),
  );
};

export const deactivate = (): void => {
  // no-op
};
