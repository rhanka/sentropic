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
