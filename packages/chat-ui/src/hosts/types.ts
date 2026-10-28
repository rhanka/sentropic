/** Neutral visual host and attachment adapter contracts. */

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
 * ChatComposerAttachmentDraft — re-exported from canonical location.
 * Canonical definition lives in documents/types.ts (D7 dedup).
 * This re-export keeps existing imports from ./hosts/types resolving.
 */
export type { ChatComposerAttachmentDraft } from '../documents/types.js';

import type { ChatComposerAttachmentDraft } from '../documents/types.js';

export interface ChatAttachmentHostAdapter {
  acceptMimeTypes: readonly string[];
  createPreviewUrl?: (file: File) => string;
  uploadAttachment: (draft: ChatComposerAttachmentDraft, file?: File) => Promise<ChatComposerAttachmentDraft>;
  removeAttachment?: (draft: ChatComposerAttachmentDraft) => Promise<string> | string;
}
