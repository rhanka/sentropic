<script lang="ts">
  /**
   * ChatContextPicker — a faithful extraction of the composer context picker from AppChatPanel.
   *
   * Renders a vertical icon+label toggle list for context entries.
   * Active / inactive states drive the text-slate-900 / text-slate-400 CSS class split.
   * An optional named slot "leading" is provided for the host to inject a pinned row
   * (e.g. the extension active-tab row) above the scrollable entry list.
   *
   * Domain-neutral: `entries` uses `ChatContextEntry` from chat-context (open `type` string).
   * Icon resolution and toggle handling stay host-owned via `iconFor` and `onToggle`.
   *
   * Wave 2 canonical picker (replaces the orphan ContextChips for this surface).
   */

  import type { ChatContextEntry } from '../state/chat-context.js';
  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /** List of context entries to render. */
  export let entries: ChatContextEntry[] = [];

  /**
   * Icon resolver — called with each entry; should return the icon component
   * (e.g. a @lucide/svelte icon class) or undefined.  Component is rendered
   * via <svelte:component this={iconFor(e)}.
   */
  export let iconFor: ((e: ChatContextEntry) => unknown) | undefined = undefined;

  /**
   * Called when the user clicks a context entry button.
   * The host toggles active state and persists prefs.
   */
  export let onToggle: ((e: ChatContextEntry) => void) | undefined = undefined;

  /** i18n / label resolver — not used for the picker rows themselves but available for hosts. */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  /**
   * Inline style for the container's max-height (e.g. 'max-height:10rem').
   * Defaults to 'max-height:10rem' when not supplied.
   */
  export let maxHeightStyle: string = 'max-height:10rem';
</script>

<!--
  Container — space-y-1 vertical list, overflow with slim-scroll.
  The host controls height via maxHeightStyle.
-->
<div class="space-y-1 overflow-auto slim-scroll" style={maxHeightStyle}>
  <!--
    Leading slot — hosts inject a pinned non-toggle row here, e.g. the
    extension active-tab display row (Globe + activeTabPrefix label).
  -->
  <slot name="leading" />

  {#each entries as e (e.type + ':' + (e.id ?? ''))}
    <button
      class={`flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50 ${
        e.active ? 'text-slate-900' : 'text-slate-400'
      }`}
      type="button"
      on:click={() => onToggle?.(e)}
    >
      <svelte:component this={iconFor?.(e)} class="w-4 h-4" />
      <span class="truncate max-w-[220px]">{e.label}</span>
    </button>
  {/each}
</div>
