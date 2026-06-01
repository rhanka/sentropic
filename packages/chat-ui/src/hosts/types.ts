/**
 * BR14a Lot 2/5 — @sentropic/chat-ui host adapter types.
 *
 * Web / Chrome / VSCode host adapter shapes. Lot 2 defined the
 * `kind` discriminant and minimal optional bridge hooks; Lot 5 adds the
 * `LocalToolsAdapter` contract consumed by `stores/localTools.ts` so
 * Chrome and VSCode hosts can plug a custom local-tool transport
 * without the package reaching for `globalThis.chrome` directly.
 *
 * The full `ChatUiHostAdapter` aggregate surface (transport, streamClient,
 * auth, navigation, storage, contextProvider, renderers) remains a Lot 6+
 * milestone per `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`.
 */

export interface HostAdapter {
  kind: 'web' | 'chrome' | 'vscode';
  postToHost?(message: unknown): void;
  onHostMessage?(handler: (message: unknown) => void): void;
}

export interface WebHostAdapter extends HostAdapter {
  kind: 'web';
}

export interface ChromeHostAdapter extends HostAdapter {
  kind: 'chrome';
  injectScript?(script: string): void;
}

export interface VsCodeHostAdapter extends HostAdapter {
  kind: 'vscode';
  acquireVsCodeApi?(): unknown;
}

export type AnyHostAdapter =
  | WebHostAdapter
  | ChromeHostAdapter
  | VsCodeHostAdapter;

/**
 * Local-tools host adapter contract consumed by the package
 * `stores/localTools.ts` module. Chrome's native `chrome.runtime`
 * already satisfies this shape; VSCode webview installs a runtime
 * shim that also satisfies it (see `ui/vscode-ext/webview-entry.ts`).
 *
 * Hosts may provide their own concrete adapter through the package's
 * `setLocalToolsAdapter` setter to override the default
 * `globalThis.chrome.runtime` lookup (used by tests and embedded hosts
 * that do not pollute `globalThis`).
 */
export interface LocalToolsAdapter {
  /** Stable runtime identifier (`'sentropic.vscode.runtime'` selects VSCode tool catalog). */
  id?: string;
  /**
   * Send a typed message to the host runtime. The package only relies
   * on the response envelope shape (`ok`, `result`, `error`,
   * `permissionRequest`, `items`, `item`); concrete hosts decide how
   * to route the message internally.
   */
  sendMessage?: (message: unknown) => Promise<{
    ok?: boolean;
    result?: unknown;
    error?: string;
    permissionRequest?: unknown;
    items?: unknown;
    item?: unknown;
  }>;
}
