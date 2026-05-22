import { describe, expect, it } from 'vitest';
import {
  coerceChatWidgetTab,
  computeChatWidgetDockWidthCss,
  resolveChatWidgetJobBadge,
  resolveChatWidgetPanelVisibility,
  resolveEffectiveChatWidgetMode,
  shouldAutoCloseChatWidget,
} from '../src/state/chatWidgetShell.js';

describe('chat widget shell state', () => {
  it('coerces active tabs and blocks comments in plugin mode', () => {
    expect(coerceChatWidgetTab('queue', { canUseComments: false })).toBe('queue');
    expect(coerceChatWidgetTab('comments', { canUseComments: true })).toBe('comments');
    expect(coerceChatWidgetTab('comments', { canUseComments: false })).toBe('chat');
    expect(coerceChatWidgetTab('unknown', { canUseComments: true })).toBe('chat');
  });

  it('resolves the effective dock/floating mode for host and viewport constraints', () => {
    expect(
      resolveEffectiveChatWidgetMode({
        hostMode: 'sidepanel',
        isExtensionOverlayHost: false,
        isMobileViewport: false,
        displayMode: 'floating',
      }),
    ).toBe('docked');

    expect(
      resolveEffectiveChatWidgetMode({
        hostMode: 'overlay',
        isExtensionOverlayHost: true,
        isMobileViewport: true,
        displayMode: 'docked',
      }),
    ).toBe('floating');

    expect(
      resolveEffectiveChatWidgetMode({
        hostMode: 'overlay',
        isExtensionOverlayHost: false,
        isMobileViewport: true,
        displayMode: 'floating',
      }),
    ).toBe('docked');
  });

  it('computes stable dock widths from viewport size', () => {
    expect(computeChatWidgetDockWidthCss({ isBrowser: false, viewportWidth: 1200 })).toBe('0px');
    expect(computeChatWidgetDockWidthCss({ isBrowser: true, viewportWidth: 500 })).toBe('100vw');
    expect(computeChatWidgetDockWidthCss({ isBrowser: true, viewportWidth: 960 })).toBe('50vw');
    expect(computeChatWidgetDockWidthCss({ isBrowser: true, viewportWidth: 1600 })).toBe('33vw');
  });

  it('resolves queue badge precedence', () => {
    expect(resolveChatWidgetJobBadge({ isLoading: true, activeJobsCount: 0, failedJobsCount: 3 })).toEqual({
      kind: 'loading',
      count: 0,
    });
    expect(resolveChatWidgetJobBadge({ isLoading: false, activeJobsCount: 2, failedJobsCount: 3 })).toEqual({
      kind: 'active',
      count: 2,
    });
    expect(resolveChatWidgetJobBadge({ isLoading: false, activeJobsCount: 0, failedJobsCount: 3 })).toEqual({
      kind: 'failed',
      count: 3,
    });
    expect(resolveChatWidgetJobBadge({ isLoading: false, activeJobsCount: 0, failedJobsCount: 0 })).toEqual({
      kind: 'none',
      count: 0,
    });
  });

  it('keeps mobile auto-close and panel visibility policy pure', () => {
    expect(
      shouldAutoCloseChatWidget({
        isExtensionOverlayHost: false,
        isDocked: true,
        isMobileViewport: true,
        isVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldAutoCloseChatWidget({
        isExtensionOverlayHost: false,
        isDocked: true,
        isMobileViewport: false,
        isVisible: true,
      }),
    ).toBe(false);

    expect(
      resolveChatWidgetPanelVisibility({
        activeTab: 'comments',
        isPluginMode: false,
        hasCommentContext: true,
      }),
    ).toEqual({
      showQueuePanel: false,
      showCommentsPanel: true,
      showCommentsContext: true,
      showChatPanel: false,
    });
    expect(
      resolveChatWidgetPanelVisibility({
        activeTab: 'comments',
        isPluginMode: true,
        hasCommentContext: true,
      }).showChatPanel,
    ).toBe(true);
  });
});
