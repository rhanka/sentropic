import type { Component } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type { AgentsListRow } from '../state/agentsSort.js';

export type AgentsListProps = {
  /** Display-ordered rows (use `buildAgentsListRows()` to derive them). */
  rows?: AgentsListRow[];
  /** Id of the currently open entry; drives the selected row. */
  activeId?: string;
  /** i18n / label resolver injected by the host. No hardcoded user-visible string. */
  labels?: ChatUiLabelResolver;
  /** Called when the user activates a row (click or keyboard). */
  onSelect: (entryId: string) => void;
  /** Optional kind-specific row action (cancel, retry, delete, stop, view…). */
  onAction?: (entryId: string, action: string) => void;
  /**
   * Injected relative-time formatter. The component never reads the clock, so
   * its rendering stays deterministic and testable.
   */
  formatRelative?: (epochMs: number) => string;
};

declare const AgentsList: Component<AgentsListProps>;

export default AgentsList;
