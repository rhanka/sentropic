<script lang="ts">
  import type { Snippet } from 'svelte';

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
  export let renderComposerSurface: Snippet<[]>;
  export let renderFloatingLayer: Snippet<[]>;
  export let renderAttachmentTray: Snippet<[]> | undefined = undefined;
  export let renderLeftControls: Snippet<[]>;
  export let renderRightActions: Snippet<[]>;
</script>

<div class="chat-composer-footer p-2 border-t border-slate-200" data-mode={mode}>
  <div>
    <div class="relative">
      <div
        class="chat-composer-surface relative w-full min-w-0 rounded px-2 text-xs composer-rich slim-scroll overflow-y-auto overflow-x-hidden"
        class:composer-single-line={!isMultiline}
        class:bg-white={surfaceEnabled}
        class:bg-slate-50={surfaceDisabled}
        data-empty-value={!value.trim()}
        style={`max-height: ${maxHeight}px;`}
        bind:this={composerElement}
        role="textbox"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabindex={tabIndex}
        on:keydown={onKeyDown}
      >
        {@render renderComposerSurface()}
      </div>
      {@render renderFloatingLayer()}
    </div>

    {#if renderAttachmentTray}
      {@render renderAttachmentTray()}
    {/if}

    <div class="flex items-center gap-1.5">
      {@render renderLeftControls()}
      <div class="ml-auto flex items-center gap-2">
        {@render renderRightActions()}
      </div>
    </div>
  </div>
</div>

<style>
  .composer-rich :global(.markdown-input-wrapper) {
    padding-left: 0;
    margin-left: 0;
    border-left: 0;
  }

  .composer-rich :global(.markdown-input-wrapper:hover) {
    border-left-color: transparent;
    background-color: transparent;
  }

  .composer-rich :global(.markdown-wrapper) {
    max-height: 100%;
    overflow: hidden;
  }

  .composer-rich :global(.ProseMirror) {
    outline: none;
  }

  .composer-single-line :global(.ProseMirror) {
    line-height: 1.25rem;
  }
</style>
