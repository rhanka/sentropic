import type { ChatWidgetDisplayMode } from '../stores/chatWidgetLayout.js';

export type ChatWidgetTab = 'chat' | 'queue' | 'comments';
export type ChatWidgetHostMode = 'overlay' | 'sidepanel';

export type ChatWidgetJobBadge =
  | { kind: 'loading'; count: 0 }
  | { kind: 'active'; count: number }
  | { kind: 'failed'; count: number }
  | { kind: 'none'; count: 0 };

export type ChatWidgetPanelVisibility = {
  showQueuePanel: boolean;
  showCommentsPanel: boolean;
  showCommentsContext: boolean;
  showChatPanel: boolean;
};

export const coerceChatWidgetTab = (
  value: unknown,
  opts: { canUseComments: boolean },
): ChatWidgetTab => {
  if (value === 'queue') return 'queue';
  if (value === 'comments') return opts.canUseComments ? 'comments' : 'chat';
  return 'chat';
};

export const resolveEffectiveChatWidgetMode = (input: {
  hostMode: ChatWidgetHostMode;
  isExtensionOverlayHost: boolean;
  isMobileViewport: boolean;
  displayMode: ChatWidgetDisplayMode;
}): ChatWidgetDisplayMode => {
  if (input.hostMode === 'sidepanel') return 'docked';
  if (input.isExtensionOverlayHost) return 'floating';
  if (input.isMobileViewport) return 'docked';
  return input.displayMode;
};

/** A placement menu can act only in an ordinary desktop overlay. */
export const canChatPlacementMenuOwnPlacement = (input: {
  hostMode: ChatWidgetHostMode;
  isExtensionOverlayHost: boolean;
  isMobileViewport: boolean;
}): boolean =>
  input.hostMode !== 'sidepanel' &&
  !input.isExtensionOverlayHost &&
  !input.isMobileViewport;

export const computeChatWidgetDockWidthCss = (input: {
  isBrowser: boolean;
  viewportWidth: number;
  minWidgetPx?: number;
}): string => {
  if (!input.isBrowser) return '0px';
  const width = Number.isFinite(input.viewportWidth) ? input.viewportWidth : 0;
  const minWidgetPx = input.minWidgetPx ?? 28 * 16;
  if (width < 640) return '100vw';
  if (width < 1024) {
    return width * 0.5 < minWidgetPx ? '100vw' : '50vw';
  }
  if (width * 0.33 >= minWidgetPx) return '33vw';
  return width * 0.5 < minWidgetPx ? '100vw' : '50vw';
};

export const resolveChatWidgetJobBadge = (input: {
  isLoading: boolean;
  activeJobsCount: number;
  failedJobsCount: number;
}): ChatWidgetJobBadge => {
  if (input.isLoading) return { kind: 'loading', count: 0 };
  if (input.activeJobsCount > 0) {
    return { kind: 'active', count: input.activeJobsCount };
  }
  if (input.failedJobsCount > 0) {
    return { kind: 'failed', count: input.failedJobsCount };
  }
  return { kind: 'none', count: 0 };
};

export const shouldAutoCloseChatWidget = (input: {
  isExtensionOverlayHost: boolean;
  isDocked: boolean;
  isMobileViewport: boolean;
  isVisible: boolean;
}): boolean => {
  if (!input.isVisible) return false;
  if (input.isExtensionOverlayHost) return true;
  return input.isDocked && input.isMobileViewport;
};

export const resolveChatWidgetPanelVisibility = (input: {
  activeTab: ChatWidgetTab;
  isPluginMode: boolean;
  hasCommentContext: boolean;
}): ChatWidgetPanelVisibility => {
  const showCommentsPanel = input.activeTab === 'comments' && !input.isPluginMode;
  return {
    showQueuePanel: input.activeTab === 'queue',
    showCommentsPanel,
    showCommentsContext: showCommentsPanel && input.hasCommentContext,
    showChatPanel:
      input.activeTab === 'chat' ||
      (input.activeTab === 'comments' && input.isPluginMode),
  };
};

/**
 * Sessions bar (gold shell S1a) — headless state for the conversation bar the
 * sentropic dock renders above the chat panel: truncated active-session label,
 * session list menu, "new" and "delete" actions with inline delete confirm.
 * i18n stays host-injected via `labels` (framework-neutral: usable from
 * Svelte/React/Angular/Vue views).
 */
export type ChatWidgetSession = { id: string; title?: string | null };

export type SessionsBarLabels = {
  none: string;
  loading: string;
  /** Fallback title for untitled sessions; receives the 6-char short id. */
  defaultTitle: (shortId: string) => string;
};

export type SessionsBarState = {
  activeSession: ChatWidgetSession | null;
  label: string;
  labelKind: 'loading' | 'active' | 'none';
  canDelete: boolean;
  deleteConfirmPending: boolean;
};

export const formatChatSessionLabel = (
  session: ChatWidgetSession,
  defaultTitle: SessionsBarLabels['defaultTitle'],
): string => (session.title ? session.title : defaultTitle(session.id.slice(0, 6)));

export const findActiveChatSession = (
  sessions: ReadonlyArray<ChatWidgetSession>,
  sessionId: string | null,
): ChatWidgetSession | null =>
  sessionId ? (sessions.find((s) => s.id === sessionId) ?? null) : null;

/** Delete-confirm survives only while a session is selected. */
export const reduceSessionDeleteConfirm = (
  pending: boolean,
  sessionId: string | null,
): boolean => (sessionId ? pending : false);

export const resolveSessionsBar = (input: {
  sessions: ReadonlyArray<ChatWidgetSession>;
  sessionId: string | null;
  loading: boolean;
  deleteConfirmPending: boolean;
  labels: SessionsBarLabels;
}): SessionsBarState => {
  const activeSession = findActiveChatSession(input.sessions, input.sessionId);
  const deleteConfirmPending = reduceSessionDeleteConfirm(
    input.deleteConfirmPending,
    input.sessionId,
  );
  const canDelete = input.sessionId !== null && input.sessionId !== '';
  if (input.loading) {
    return {
      activeSession,
      label: input.labels.loading,
      labelKind: 'loading',
      canDelete,
      deleteConfirmPending,
    };
  }
  if (activeSession) {
    return {
      activeSession,
      label: formatChatSessionLabel(activeSession, input.labels.defaultTitle),
      labelKind: 'active',
      canDelete,
      deleteConfirmPending,
    };
  }
  return {
    activeSession: null,
    label: input.labels.none,
    labelKind: 'none',
    canDelete,
    deleteConfirmPending,
  };
};
