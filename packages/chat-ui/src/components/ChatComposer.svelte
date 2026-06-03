<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, onDestroy } from 'svelte';
  import { computeAutosizeResult } from '../utils/composer-autosize.js';

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

  // ---------------------------------------------------------------------------
  // P6 — opt-in auto-grow props (defaults preserve existing behavior).
  // ---------------------------------------------------------------------------

  /**
   * When true, the composer surface grows with content (auto-grow).
   * Default false = existing behavior (static maxHeight prop drives height).
   */
  export let autoGrow = false;

  /**
   * Single-line (base) height in px used for auto-grow calculations.
   * Only relevant when autoGrow=true. Defaults to 40 (matches app constant).
   */
  export let baseHeight = 40;

  /**
   * Height of the outer scroll container in px used to cap auto-grow.
   * 0 = unconstrained. Only relevant when autoGrow=true.
   */
  export let containerHeight = 0;

  // ---------------------------------------------------------------------------
  // Auto-grow internal state (no-op when autoGrow=false).
  // ---------------------------------------------------------------------------

  let autoGrowMaxHeight = maxHeight; // starts equal to maxHeight prop
  let wasMultiline = false;
  let observer: ResizeObserver | null = null;

  // Derived surface max-height: use autoGrowMaxHeight when auto-grow is on,
  // fall back to the maxHeight prop otherwise.
  $: surfaceMaxHeight = autoGrow ? autoGrowMaxHeight : maxHeight;

  function measureAndUpdate() {
    if (!composerElement) return;
    const result = computeAutosizeResult({
      baseHeight,
      containerHeight,
      contentHeight: composerElement.scrollHeight || baseHeight,
      wasMultiline,
    });
    autoGrowMaxHeight = result.maxHeight;
    isMultiline = result.isMultiline;
    wasMultiline = result.isMultiline;
    if (result.shouldRemeasure) {
      requestAnimationFrame(measureAndUpdate);
    }
  }

  function attachObserver(el: HTMLDivElement | null) {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (!el || !autoGrow) return;
    // ResizeObserver may be unavailable in SSR or test environments — guard safely.
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measureAndUpdate());
      observer.observe(el);
    }
    measureAndUpdate();
  }

  // Re-attach observer whenever composerElement or autoGrow changes.
  $: if (autoGrow) {
    attachObserver(composerElement);
  } else if (observer) {
    observer.disconnect();
    observer = null;
  }

  // Re-measure when value changes (content typed by user).
  $: if (autoGrow && value !== undefined) {
    measureAndUpdate();
  }

  onMount(() => {
    if (autoGrow) attachObserver(composerElement);
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
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
        data-auto-grow={autoGrow}
        style={`max-height: ${surfaceMaxHeight}px;`}
        bind:this={composerElement}
        role="textbox"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabindex={tabIndex}
        on:keydown={onKeyDown}
        on:paste={onPaste}
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
