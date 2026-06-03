import type { Component } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type { SessionListEntry } from '../state/sessionList.js';

export type SessionListProps = {
  /** Sorted session list (use projectSessionList() to derive from HTTP response). */
  sessions?: SessionListEntry[];
  /** Id of the currently active/open session (drives active-row highlight). */
  activeId?: string;
  /** i18n / label resolver injected by the host. */
  labels?: ChatUiLabelResolver;
  /**
   * Called when the user selects a session.
   * The host loads the session history via transport.getHistory / fetchBootstrap.
   */
  onSelect: (sessionId: string) => void;
  /**
   * Optional: called when the user clicks the delete button on a session entry.
   * If not provided, no delete button is rendered.
   */
  onDelete?: (sessionId: string) => void;
};

declare const SessionList: Component<SessionListProps>;

export default SessionList;
