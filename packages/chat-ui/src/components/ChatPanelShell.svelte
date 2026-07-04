<script lang="ts">
  /**
   * ChatPanelShell — the sentropic gold chat panel composition, extracted
   * from the app-local `AppChatPanel.svelte` (gold shell program, Lot A1).
   *
   * Headless-first contract: every domain concern is injected — comment host,
   * i18n `labels`, and host-rendered snippets (rich-text input, popover
   * menus). The shell owns the gold MARKUP; orchestration state comes from
   * the headless helpers in `state/*` so future React/Angular/Vue views can
   * mount the same logic.
   *
   * Slice status (branch feat/chatui-gold-shell):
   * - S5a1: shell root + comments mode (CommentsPanel forwarding).
   * - S5a2+: AI mode region (timeline + composer) lands next, replacing the
   *   `ai` slot seam.
   */
  import type { Snippet } from 'svelte';

  import CommentsPanel from '../comments/CommentsPanel.svelte';
  import type { CommentHost } from '../comments/host.js';
  import type { CommentThreadSummary } from '../comments/types.js';

  export let mode: 'ai' | 'comments' = 'ai';

  /** Root panel element, bindable so the host can measure (hydration flush). */
  export let panelEl: HTMLDivElement | null = null;

  // --- comments mode (forwarded to CommentsPanel, same contract) ---
  export let commentHost: CommentHost | null = null;
  export let commentContextType: string | null = null;
  export let commentContextId: string | null = null;
  export let commentSectionKey: string | null = null;
  export let commentSectionLabel: string | null = null;
  export let commentThreadId: string | null = null;
  export let commentLoading = false;

  /** i18n — host-injected translator, zero domain strings in the module. */
  export let labels: (key: string, opts?: Record<string, unknown>) => string = (
    k,
  ) => k;

  /** Host-rendered rich-text composer input (e.g. TipTap contenteditable). */
  export let renderComposerInput:
    | Snippet<
        [
          {
            value: string;
            disabled: boolean;
            placeholder: string;
            onChange: (v: string) => void;
            onKeyDown: (e: KeyboardEvent) => void;
          },
        ]
      >
    | undefined = undefined;

  /** Host-rendered thread picker popover (menu component stays host-side). */
  export let renderThreadMenuPopover:
    | Snippet<
        [
          {
            threads: CommentThreadSummary[];
            currentThreadId: string | null;
            resolvedCount: number;
            showResolvedComments: boolean;
            onSelect: (t: CommentThreadSummary) => void;
            onNew: () => void;
            onToggleShowResolved: () => void;
            getThreadSectionLabel: (sectionKey: string | null) => string;
          },
        ]
      >
    | undefined = undefined;
</script>

<div class="topai-chat-panel-shell flex flex-col h-full" bind:this={panelEl}>
  {#if mode === 'comments'}
    {#if commentHost}
      <CommentsPanel
        host={commentHost}
        contextType={commentContextType}
        contextId={commentContextId}
        sectionKey={commentSectionKey}
        sectionLabel={commentSectionLabel}
        bind:commentThreadId
        bind:commentLoading
        {labels}
        {renderComposerInput}
        {renderThreadMenuPopover}
      />
    {/if}
  {:else}
    <!-- AI mode: gold timeline + composer region — lands in S5a2+ (slot seam
         keeps the component compiling and testable until the region moves). -->
    <slot name="ai" />
  {/if}
</div>
