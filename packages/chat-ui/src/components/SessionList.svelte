<script lang="ts">
  /**
   * SessionList — presentational session list component for radar P4.
   *
   * Renders a sorted list of chat sessions with title, last-activity timestamp,
   * and an active-session highlight. Selecting a session calls `onSelect` —
   * the host is responsible for loading history via the transport.
   *
   * Contract:
   * - `sessions`   — array of `SessionListEntry` (use `projectSessionList()` to obtain).
   * - `activeId`   — id of the currently active session (optional); drives CSS highlight.
   * - `labels`     — injected `(key: string) => string` resolver for all user-visible text.
   *                  No hardcoded strings. Default: returns the key itself.
   * - `onSelect`   — called with `sessionId` when the user clicks a session row.
   * - `onDelete`   — optional; called with `sessionId` when the user clicks the delete button.
   *                  If not provided, no delete button is rendered.
   */

  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
  import type { SessionListEntry } from '../state/sessionList.js';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  /** Sorted session list (use projectSessionList() to derive from HTTP response). */
  export let sessions: SessionListEntry[] = [];

  /** Id of the currently active/open session (drives active-row highlight). */
  export let activeId: string | undefined = undefined;

  /**
   * i18n / label resolver injected by the host.
   * Key catalog used by this component:
   *   'chat.session.list.label'         — aria-label for the list region
   *   'chat.session.untitled'           — fallback text for sessions with no title
   *   'chat.session.delete.label'       — aria-label for the delete button
   */
  export let labels: ChatUiLabelResolver | undefined = undefined;

  /**
   * Called when the user selects a session.
   * The host loads the session history via transport.getHistory / fetchBootstrap.
   */
  export let onSelect: (sessionId: string) => void;

  /**
   * Optional: called when the user clicks the delete button on a session entry.
   * If not provided, no delete button is rendered.
   */
  export let onDelete: ((sessionId: string) => void) | undefined = undefined;

  // ---------------------------------------------------------------------------
  // Label resolver — falls back to the key when no resolver is provided
  // ---------------------------------------------------------------------------

  const resolveLabel = (key: string): string => labels?.(key) ?? key;
</script>

<!--
  Session list — a scrollable nav region.
  Each row: title, last-activity relative timestamp, optional delete button.
  Active row receives aria-current="page" and a CSS modifier class.
-->
<nav
  class="chat-session-list flex flex-col overflow-y-auto"
  aria-label={resolveLabel('chat.session.list.label')}
>
  {#if sessions.length === 0}
    <p class="chat-session-list-empty px-3 py-2 text-sm opacity-60">
      {resolveLabel('chat.session.list.empty')}
    </p>
  {:else}
    <ul role="list" class="flex flex-col gap-0">
      {#each sessions as session (session.id)}
        {@const isActive = session.id === activeId}
        <li
          role="listitem"
          class="chat-session-list-item flex items-center gap-1"
          class:chat-session-list-item-active={isActive}
          aria-current={isActive ? 'page' : undefined}
        >
          <button
            type="button"
            class="chat-session-list-select flex-1 truncate px-3 py-2 text-left text-sm"
            on:click={() => onSelect(session.id)}
            aria-pressed={isActive ? 'true' : undefined}
          >
            <span class="chat-session-list-title block truncate font-medium">
              {session.title ?? resolveLabel('chat.session.untitled')}
            </span>
          </button>
          {#if onDelete}
            <button
              type="button"
              class="chat-session-list-delete flex-shrink-0 px-2 py-2 opacity-50 hover:opacity-100"
              aria-label={resolveLabel('chat.session.delete.label')}
              on:click|stopPropagation={() => onDelete?.(session.id)}
            >
              ×
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</nav>
