import type { Component, Snippet } from 'svelte';

export type ChatComposerProps = {
  mode?: 'ai' | 'comments';
  value?: string;
  disabled?: boolean;
  isMultiline?: boolean;
  maxHeight?: number;
  surfaceEnabled?: boolean;
  surfaceDisabled?: boolean;
  ariaLabel?: string;
  tabIndex?: number;
  composerElement?: HTMLDivElement | null;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => void;
  renderComposerSurface: Snippet<[]>;
  renderFloatingLayer: Snippet<[]>;
  renderAttachmentTray?: Snippet<[]>;
  renderLeftControls: Snippet<[]>;
  renderRightActions: Snippet<[]>;
  // P6 opt-in auto-grow props (defaults preserve existing behavior)
  autoGrow?: boolean;
  baseHeight?: number;
  containerHeight?: number;
};

declare const ChatComposer: Component<ChatComposerProps>;

export default ChatComposer;
