<script lang="ts">
  import type { Snippet } from 'svelte';
  import PackageChatComposer from '@sentropic/chat-ui/components/ChatComposer.svelte';

  export let mode: 'ai' | 'comments' = 'ai';
  export let value = '';
  export let disabled = false;
  export let isMultiline = false;
  export let maxHeight = 40;
  export let surfaceEnabled = true;
  export let surfaceDisabled = false;
  export let ariaLabel = '';
  export let tabIndex = 0;
  export let composerElement: HTMLDivElement | null = null;
  export let onKeyDown: ((event: KeyboardEvent) => void) | undefined = undefined;
  export let onPaste: ((event: ClipboardEvent) => void) | undefined = undefined;
  export let renderComposerSurface: Snippet<[]>;
  export let renderFloatingLayer: Snippet<[]>;
  export let renderAttachmentTray: Snippet<[]> | undefined = undefined;
  export let renderLeftControls: Snippet<[]>;
  export let renderRightActions: Snippet<[]>;
</script>

<PackageChatComposer
  {mode}
  {value}
  {disabled}
  {isMultiline}
  {maxHeight}
  {surfaceEnabled}
  {surfaceDisabled}
  {ariaLabel}
  {tabIndex}
  bind:composerElement
  {onKeyDown}
  {onPaste}
  {renderComposerSurface}
  {renderFloatingLayer}
  {renderAttachmentTray}
  {renderLeftControls}
  {renderRightActions}
/>
