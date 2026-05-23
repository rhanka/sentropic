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
  renderComposerSurface: Snippet<[]>;
  renderFloatingLayer: Snippet<[]>;
  renderLeftControls: Snippet<[]>;
  renderRightActions: Snippet<[]>;
};

declare const ChatComposer: Component<ChatComposerProps>;

export default ChatComposer;
