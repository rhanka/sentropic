import * as vscode from 'vscode';

const COMMAND_OPEN_PANEL = 'topai.openPanel';
const COMMAND_CODEX_SIGN_IN = 'topai.codex.signIn';
const VIEW_TYPE = 'topai.chat';
const STATE_KEY_CODEX_CONNECTED = 'topai.codexConnected';

type TopAiRuntimeConfig = {
  apiBaseUrl: string;
  sessionToken: string;
  codexSignInUrl: string;
};

const defaultConfig: TopAiRuntimeConfig = {
  apiBaseUrl: 'http://localhost:8705/api/v1',
  sessionToken: '',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
};

const readRuntimeConfig = (): TopAiRuntimeConfig => {
  const config = vscode.workspace.getConfiguration('topai');
  const apiBaseUrl = String(config.get<string>('apiBaseUrl', defaultConfig.apiBaseUrl)).trim();
  const sessionToken = String(config.get<string>('sessionToken', defaultConfig.sessionToken)).trim();
  const codexSignInUrl = String(config.get<string>('codexSignInUrl', defaultConfig.codexSignInUrl)).trim();

  return {
    apiBaseUrl,
    sessionToken,
    codexSignInUrl,
  };
};

const createWebviewHtml = (webview: vscode.Webview, extensionUri: vscode.Uri, config: TopAiRuntimeConfig): string => {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview-entry.js'));
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
  <body>
    <div id="topai-vscode-root"></div>
    <script nonce="${nonce}">
      window.__TOPAI_VSCODE_RUNTIME__ = ${runtimeConfigJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
};

const openCodexSignIn = async (
  context: vscode.ExtensionContext,
  config: TopAiRuntimeConfig,
): Promise<{ opened: boolean; url: string }> => {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(config.codexSignInUrl));
  if (opened) {
    await context.globalState.update(STATE_KEY_CODEX_CONNECTED, true);
  }
  return { opened, url: config.codexSignInUrl };
};

export const activate = (context: vscode.ExtensionContext): void => {
  let panel: vscode.WebviewPanel | null = null;

  const revealPanel = (): vscode.WebviewPanel => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside, true);
      panel.webview.html = createWebviewHtml(panel.webview, context.extensionUri, readRuntimeConfig());
      return panel;
    }

    panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Top AI Ideas',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    panel.webview.html = createWebviewHtml(panel.webview, context.extensionUri, readRuntimeConfig());

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const payload = message as Record<string, unknown>;
      if (payload.source !== 'topai-vscode-webview') return;
      if (payload.type !== 'request') return;

      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      const command = typeof payload.command === 'string' ? payload.command : '';
      if (!requestId || !command) return;

      const respond = (ok: boolean, resultPayload?: unknown, error?: string): void => {
        panel?.webview.postMessage({
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
          respond(true, readRuntimeConfig());
          return;
        }

        if (command === 'auth.codex.status') {
          const connected = Boolean(context.globalState.get<boolean>(STATE_KEY_CODEX_CONNECTED, false));
          respond(true, {
            connected,
            accountLabel: null,
            reason: connected ? 'Codex sign-in initiated in this extension profile.' : 'not_connected',
          });
          return;
        }

        if (command === 'auth.codex.signIn') {
          const result = await openCodexSignIn(context, readRuntimeConfig());
          respond(true, result);
          return;
        }

        respond(false, undefined, `Unsupported command: ${command}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        respond(false, undefined, message);
      }
    });

    panel.onDidDispose(() => {
      panel = null;
    });

    return panel;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_PANEL, () => {
      revealPanel();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CODEX_SIGN_IN, async () => {
      await openCodexSignIn(context, readRuntimeConfig());
      if (panel) {
        panel.webview.html = createWebviewHtml(panel.webview, context.extensionUri, readRuntimeConfig());
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('topai')) return;
      if (!panel) return;
      panel.webview.html = createWebviewHtml(panel.webview, context.extensionUri, readRuntimeConfig());
    }),
  );

  revealPanel();
};

export const deactivate = (): void => {
  // no-op
};
