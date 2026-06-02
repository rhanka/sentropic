// ChatWidgetDisplayMode is defined here (moved from stores/chatWidgetLayout) to break
// the edge between the headless core and the Svelte store.
export type ChatWidgetDisplayMode = 'floating' | 'docked';

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
