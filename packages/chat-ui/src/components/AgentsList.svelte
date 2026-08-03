<script lang="ts">
  import {
    Badge,
    EmptyState,
    Icon,
    OverflowMenu,
    SelectableList,
    SelectableRow,
    StatusDot,
    Tag,
    type OverflowMenuItem,
  } from '@sentropic/design-system-svelte';

  import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
  import type { AgentsEntryKind, AgentsEntryStatus } from '../state/agentsEntry.js';
  import type { AgentsListRow } from '../state/agentsSort.js';

  export let rows: AgentsListRow[] = [];
  export let activeId: string | undefined = undefined;
  export let labels: ChatUiLabelResolver | undefined = undefined;
  export let onSelect: (entryId: string) => void;
  export let onAction: ((entryId: string, action: string) => void) | undefined = undefined;
  export let formatRelative: ((epochMs: number) => string) | undefined = undefined;

  type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

  const STATUS_TONES: Record<AgentsEntryStatus, StatusTone> = {
    'awaiting-input': 'warning',
    running: 'info',
    active: 'neutral',
    failed: 'error',
    done: 'success',
    idle: 'neutral',
  };

  const ICON_BY_KIND: Record<AgentsEntryKind, 'layers' | 'settings' | 'target'> = {
    agent: 'target',
    session: 'layers',
    remote: 'target',
    job: 'settings',
    run: 'layers',
  };

  const ACTIONS: Record<AgentsEntryKind, readonly string[]> = {
    agent: ['stop'],
    session: ['delete'],
    remote: ['view'],
    job: ['cancel', 'retry', 'delete'],
    run: ['cancel'],
  };

  const resolveLabel = (key: string): string => labels?.(key) ?? key;
  const titleFor = (row: AgentsListRow): string =>
    row.entry.title ?? resolveLabel(`chat.agents.kind.${row.entry.kind}`);
  const activityFor = (epochMs: number): string =>
    formatRelative?.(epochMs) ?? resolveLabel('chat.agents.activity.unknown');
  const displayStatusFor = (row: AgentsListRow): AgentsEntryStatus =>
    row.entry.kind === 'session' &&
    row.aggregateStatus !== 'running' &&
    row.aggregateStatus !== 'awaiting-input'
      ? 'active'
      : row.aggregateStatus;
  const menuItemsFor = (kind: AgentsEntryKind): OverflowMenuItem[] =>
    ACTIONS[kind].map((action) => ({
      value: action,
      label: resolveLabel(`chat.agents.action.${action}`),
      danger: action === 'delete' || action === 'stop' || action === 'cancel',
    }));

  const selectEntry = (value: string | string[] | null): void => {
    if (typeof value === 'string') onSelect(value);
  };
</script>

{#if rows.length === 0}
  <EmptyState
    title={resolveLabel('chat.agents.empty.title')}
    message={resolveLabel('chat.agents.empty.message')}
  />
{:else}
  <!--
    value is pinned to null on purpose. This is a NAVIGATION list (open on every
    click), not a selection model: a controlled `value={activeId}` makes the DS
    single-select TOGGLE OFF when the already-active row is re-clicked, emitting
    `onchange(null)` and swallowing the navigation — so returning to a session
    you just left would dead-end. With value=null every activation emits the
    row's id and navigates. The active row's highlight is carried by a class
    below, decoupled from the DS selection state.
  -->
  <SelectableList
    label={resolveLabel('chat.agents.list.label')}
    value={null}
    onchange={selectEntry}
    class="chat-agents-list"
  >
    {#each rows as row (row.entry.id)}
      {@const displayStatus = displayStatusFor(row)}
      {@const statusTone = STATUS_TONES[displayStatus]}
      {@const hasPendingQuestion = row.entry.status === 'awaiting-input'}
      <div
        class="chat-agents-list-row"
        class:chat-agents-list-row--active={activeId != null && activeId === row.entry.id}
        data-agent-entry-id={row.entry.id}
        data-depth={row.depth}
        aria-current={activeId != null && activeId === row.entry.id ? 'true' : undefined}
        style={`--agents-list-depth: ${row.depth};`}
      >
        <SelectableRow value={row.entry.id} accentBar>
          {#snippet leading()}
            <Icon name={ICON_BY_KIND[row.entry.kind]} size={18} />
          {/snippet}

          <span class="chat-agents-list-row__summary">
            <span class="chat-agents-list-row__title">{titleFor(row)}</span>
            <span class="chat-agents-list-row__activity">{activityFor(row.entry.lastActivityAt)}</span>
            {#if hasPendingQuestion}
              <Tag tone="warning" size="sm">{resolveLabel('chat.agents.pending-question')}</Tag>
              {#if row.entry.pendingPrompt}
                <span class="chat-agents-list-row__prompt">{row.entry.pendingPrompt}</span>
              {/if}
            {/if}
          </span>

          {#snippet caption()}
            <span class="chat-agents-list-row__metadata">
              <span>{row.entry.workspaceLabel ?? resolveLabel('chat.agents.workspace.unknown')}</span>
              <StatusDot
                tone={statusTone}
                pulse={displayStatus === 'running'}
                label={resolveLabel(`chat.agents.status.${displayStatus}`)}
              />
              {#if row.entry.kind === 'remote'}
                <span>{resolveLabel(`chat.agents.connection.${row.entry.connection ?? 'unknown'}`)}</span>
              {/if}
            </span>
          {/snippet}

          {#snippet trailing()}
            {#if row.childCount > 0}
              <Badge
                tone="neutral"
                size="sm"
                shape="circle"
                aria-label={resolveLabel('chat.agents.children')}
              >{row.childCount}</Badge>
            {/if}
            {#if onAction}
              <span
                class="chat-agents-list-row__actions"
                onclick={(event) => event.stopPropagation()}
                onkeydown={(event) => event.stopPropagation()}
              >
                <OverflowMenu
                  items={menuItemsFor(row.entry.kind)}
                  label={resolveLabel('chat.agents.actions.label')}
                  triggerLabel={resolveLabel('chat.agents.actions.trigger')}
                  placement="bottom-end"
                  dense
                  onselect={(action) => onAction?.(row.entry.id, action)}
                />
              </span>
            {/if}
          {/snippet}
        </SelectableRow>
      </div>
    {/each}
  </SelectableList>
{/if}

<style>
  .chat-agents-list-row {
    margin-inline-start: calc(var(--agents-list-depth) * var(--st-spacing-4, 1rem));
    min-width: 0;
    border-radius: var(--st-radius-2, 0.375rem);
  }

  /* Active-session highlight — carried here rather than by the DS selection
     state, which is pinned off so re-clicking navigates instead of toggling. */
  .chat-agents-list-row--active {
    background-color: var(--st-semantic-surface-selected, rgba(37, 99, 235, 0.08));
  }

  .chat-agents-list-row__summary,
  .chat-agents-list-row__metadata {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    min-width: 0;
  }

  .chat-agents-list-row__summary {
    flex: 1 1 auto;
  }

  .chat-agents-list-row__title {
    color: var(--st-semantic-text-primary);
    font-weight: 600;
  }

  .chat-agents-list-row__activity,
  .chat-agents-list-row__metadata,
  .chat-agents-list-row__prompt {
    color: var(--st-semantic-text-secondary);
  }

  :global(.chat-agents-list-row .st-selectableRow__leading) {
    align-self: flex-start;
  }

  .chat-agents-list-row__activity {
    color: var(--st-semantic-text-muted, var(--st-semantic-text-secondary));
    font-size: var(--st-component-selectableRow-captionFontSize, 0.75rem);
  }

  .chat-agents-list-row__prompt {
    flex-basis: 100%;
  }

  .chat-agents-list-row__actions {
    display: inline-flex;
  }
</style>
