/**
 * BR14a Lot 2 — @sentropic/chat-ui host adapter types.
 *
 * Web / Chrome / VSCode host adapter shapes. Lot 2 only defines the
 * `kind` discriminant and minimal optional bridge hooks; full
 * `ChatUiHostAdapter` surface (transport, streamClient, localTools,
 * auth, navigation, storage, contextProvider, renderers) lands in
 * Lot 3+ per `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`.
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
