import type { Component, Snippet } from 'svelte';
import type {
  ChatWidgetSession,
  SessionsBarLabels,
} from '../state/chatWidgetShell.js';

export type ChatSessionsBarProps = {
  sessions?: readonly ChatWidgetSession[];
  sessionId?: string | null;
  loading?: boolean;
  barLabels: SessionsBarLabels;
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  onNewSession?: () => void;
  onBack?: () => void;
  backLabel?: string;
  onConfirmDelete?: () => void | Promise<void>;
  deleteConfirmPending?: boolean;
  deleteInFlight?: boolean;
  renderSessionsMenu?: Snippet<
    [
      {
        sessions: readonly ChatWidgetSession[];
        sessionId: string | null;
        loading: boolean;
        formatLabel: (s: ChatWidgetSession) => string;
        onNew: () => void;
      },
    ]
  >;
  renderPlusIcon?: Snippet;
  renderTrashIcon?: Snippet;
};

declare const ChatSessionsBar: Component<ChatSessionsBarProps>;
export default ChatSessionsBar;
