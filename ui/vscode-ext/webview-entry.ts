type TopAiRuntimeConfig = {
  apiBaseUrl?: string;
  sessionToken?: string;
  codexSignInUrl?: string;
};

type VsCodeApi = {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    __TOPAI_VSCODE_RUNTIME__?: TopAiRuntimeConfig;
  }
}

const runtime = window.__TOPAI_VSCODE_RUNTIME__ ?? {};
const vscode = typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : null;

const root = document.getElementById('topai-vscode-root');
if (!root) {
  throw new Error('Missing #topai-vscode-root container.');
}

root.innerHTML = `
  <main style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; color: #1f2937;">
    <h1 style="font-size: 18px; margin: 0 0 12px;">Top AI Ideas</h1>
    <p style="margin: 0 0 8px; font-size: 13px; color: #334155;">
      VSCode extension runtime initialized.
    </p>
    <p style="margin: 0 0 14px; font-size: 12px; color: #64748b;">
      API: <code>${runtime.apiBaseUrl ?? 'not configured'}</code>
    </p>
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <button id="topai-open-codex" type="button" style="border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px; padding: 6px 10px; cursor: pointer;">Connect Codex</button>
      <button id="topai-refresh-config" type="button" style="border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 6px; padding: 6px 10px; cursor: pointer;">Refresh runtime config</button>
    </div>
    <pre id="topai-runtime-status" style="margin-top: 12px; font-size: 12px; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; white-space: pre-wrap;"></pre>
  </main>
`;

const statusNode = document.getElementById('topai-runtime-status');
const setStatus = (value: unknown): void => {
  if (!statusNode) return;
  statusNode.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const request = (command: string, payload?: unknown): Promise<unknown> => {
  if (!vscode) {
    return Promise.reject(new Error('VSCode bridge unavailable.'));
  }
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;
      if (data.source !== 'topai-vscode-host' || data.type !== 'response') return;
      if (data.requestId !== requestId) return;
      window.removeEventListener('message', onMessage);
      if (data.ok === false) {
        reject(new Error(typeof data.error === 'string' ? data.error : 'Host request failed.'));
        return;
      }
      resolve(data.payload);
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({
      source: 'topai-vscode-webview',
      type: 'request',
      command,
      requestId,
      payload,
    });
  });
};

const refreshStatus = async (): Promise<void> => {
  try {
    const config = await request('runtime.config.get');
    const auth = await request('auth.codex.status');
    setStatus({ config, auth });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
};

const openCodexButton = document.getElementById('topai-open-codex');
openCodexButton?.addEventListener('click', async () => {
  try {
    const result = await request('auth.codex.signIn');
    setStatus({ action: 'auth.codex.signIn', result });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

const refreshButton = document.getElementById('topai-refresh-config');
refreshButton?.addEventListener('click', () => {
  void refreshStatus();
});

void refreshStatus();
