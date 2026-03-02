import * as vscode from 'vscode';
import {
  createTopAiVsCodeRequestHandler,
  type TopAiRuntimeConfig,
  type TopAiVsCodeCommand,
} from './host-handler';

const COMMAND_OPEN_PANEL = 'topai.openPanel';
const VIEW_ID = 'topai.chatView';
const SECRET_SESSION_TOKEN_KEY = 'topai.sessionToken';
const CONFIG_TARGET = vscode.ConfigurationTarget.Global;

const defaultConfig: TopAiRuntimeConfig = {
  apiBaseUrl: 'http://localhost:8705/api/v1',
  appBaseUrl: 'http://localhost:5173',
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
  return value.trim();
};

const readRuntimeConfig = async (
  context: vscode.ExtensionContext,
): Promise<TopAiRuntimeConfig> => {
  const config = vscode.workspace.getConfiguration('topai');
  const apiBaseUrl = normalizeConfigString(
    config.get<string>('apiBaseUrl', defaultConfig.apiBaseUrl),
    defaultConfig.apiBaseUrl,
  );
  const appBaseUrl = normalizeConfigString(
    config.get<string>('appBaseUrl', defaultConfig.appBaseUrl),
    defaultConfig.appBaseUrl,
  );
  const wsBaseUrl = normalizeConfigString(
    config.get<string>('wsBaseUrl', defaultConfig.wsBaseUrl),
    defaultConfig.wsBaseUrl,
  );
  const codexSignInUrl = normalizeConfigString(
    config.get<string>('codexSignInUrl', defaultConfig.codexSignInUrl),
    defaultConfig.codexSignInUrl,
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
    codexSignInUrl,
  };
};

const saveRuntimeConfigPatch = async (
  context: vscode.ExtensionContext,
  payload: RuntimeConfigPatchPayload,
): Promise<TopAiRuntimeConfig> => {
  const config = vscode.workspace.getConfiguration('topai');

  if (typeof payload.apiBaseUrl === 'string') {
    await config.update('apiBaseUrl', payload.apiBaseUrl.trim(), CONFIG_TARGET);
  }
  if (typeof payload.appBaseUrl === 'string') {
    await config.update('appBaseUrl', payload.appBaseUrl.trim(), CONFIG_TARGET);
  }
  if (typeof payload.wsBaseUrl === 'string') {
    await config.update('wsBaseUrl', payload.wsBaseUrl.trim(), CONFIG_TARGET);
  }

  if (typeof payload.sessionToken === 'string') {
    const token = payload.sessionToken.trim();
    if (token.length > 0) {
      await context.secrets.store(SECRET_SESSION_TOKEN_KEY, token);
    } else {
      await context.secrets.delete(SECRET_SESSION_TOKEN_KEY);
    }

    // Keep workspace/global settings clear of plaintext tokens.
    await config.update('sessionToken', '', CONFIG_TARGET);
  }

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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
    await vscode.commands.executeCommand('workbench.view.explorer');
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
    const command = typeof payload.command === 'string' ? payload.command : '';
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

      const result = await this.runtimeHandler(command as TopAiVsCodeCommand);
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, message);
    }
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  const runtimeHandler = createTopAiVsCodeRequestHandler({
    getRuntimeConfig: () => defaultConfig,
  });

  const provider = new TopAiChatViewProvider(context, runtimeHandler);

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
