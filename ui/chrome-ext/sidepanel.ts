import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { CHATWIDGET_HANDOFF_STORAGE_KEY } from '$lib/core/chatwidget-handoff';
import { mount } from './chatwidget-entry';

const HANDOFF_EVENT = 'topai:chatwidget-handoff-state';
const OPEN_OVERLAY_EVENT = 'topai:open-overlay';
const SIDEPANEL_STATE_MESSAGE = 'sidepanel_state';
type ChatTab = 'chat' | 'queue' | 'comments';
let ownerTabId: number | null = null;
let closeSignalSent = false;
let openHeartbeatTimer: number | null = null;
let overlaySwitchInProgress = false;
const NON_INJECTABLE_URL_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
];

const canInjectContentScript = (url?: string | null): boolean => {
    if (!url) return false;
    return !NON_INJECTABLE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
};

const readHandoffState = async (): Promise<ChatWidgetHandoffState | null> => {
    try {
        const payload = await chrome.storage.local.get(CHATWIDGET_HANDOFF_STORAGE_KEY);
        return (payload?.[CHATWIDGET_HANDOFF_STORAGE_KEY] as ChatWidgetHandoffState | undefined) ?? null;
    } catch (error) {
        console.warn('Unable to read chat handoff state from storage.', error);
        return null;
    }
};

const writeHandoffState = async (state: ChatWidgetHandoffState): Promise<void> => {
    try {
        await chrome.storage.local.set({
            [CHATWIDGET_HANDOFF_STORAGE_KEY]: state,
        });
    } catch (error) {
        console.warn('Unable to persist chat handoff state to storage.', error);
    }
};

const injectStyles = () => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('chatwidget.css');
    document.head.appendChild(style);
};

const handleHandoffState = (event: Event) => {
    const detail = (event as CustomEvent<ChatWidgetHandoffState>).detail;
    if (!detail) return;
    void writeHandoffState({
        ...detail,
        source: 'sidepanel',
        updatedAt: Date.now(),
    });
};

const openOverlayInActiveTab = async (
    activeTab?: ChatTab,
): Promise<boolean> => {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = tabs[0];
        const targetTabId = targetTab?.id;
        if (typeof targetTabId !== 'number') {
            console.warn('No active tab found to reopen chat overlay.');
            return false;
        }
        ownerTabId = targetTabId;
        const tabUrl = targetTab?.url ?? null;
        const sendOpenRequest = async (): Promise<boolean> => {
            try {
                const response = await chrome.tabs.sendMessage(targetTabId, {
                    type: 'open_overlay_chat',
                    activeTab: activeTab ?? 'chat',
                });
                return Boolean(response?.ok);
            } catch {
                return false;
            }
        };

        if (await sendOpenRequest()) {
            return true;
        }

        // Fallback: content script may not yet be present (new tab / delayed injection).
        if (!canInjectContentScript(tabUrl)) {
            console.info(
                'Skipping content script injection for non-injectable tab URL while reopening overlay.',
                tabUrl,
            );
            return false;
        }
        try {
            await chrome.scripting.executeScript({
                target: { tabId: targetTabId },
                files: ['content.js'],
            });
        } catch (injectError) {
            console.warn(
                'Unable to inject content script before reopening chat overlay.',
                injectError,
            );
            return false;
        }
        return sendOpenRequest();
    } catch (error) {
        console.warn('Unable to request chat overlay opening from side panel.', error);
        return false;
    }
};

const handleOpenOverlayRequest = (event: Event) => {
    if (overlaySwitchInProgress) return;
    overlaySwitchInProgress = true;
    const detail = (event as CustomEvent<{ activeTab?: ChatTab }>).detail;
    stopOpenHeartbeat();
    closeSignalSent = false;
    void notifyContentSidePanelState('closed');
    void (async () => {
        const opened = await openOverlayInActiveTab(detail?.activeTab);
        if (!opened) {
            overlaySwitchInProgress = false;
            if (document.visibilityState === 'visible') {
                startOpenHeartbeat();
            } else {
                void notifyContentSidePanelState('closed');
            }
            return;
        }
        window.close();
    })();
};

const getActiveTabId = async (): Promise<number | null> => {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        return typeof tabId === 'number' ? tabId : null;
    } catch {
        return null;
    }
};

const notifyContentSidePanelState = async (state: 'open' | 'closed') => {
    const tabId = ownerTabId ?? (await getActiveTabId());
    if (typeof tabId !== 'number') return;
    ownerTabId = tabId;
    const sendStateMessage = async (): Promise<boolean> => {
        try {
            await chrome.tabs.sendMessage(tabId, {
                type: SIDEPANEL_STATE_MESSAGE,
                state,
            });
            return true;
        } catch {
            return false;
        }
    };

    if (await sendStateMessage()) {
        return;
    }

    const targetTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!canInjectContentScript(targetTab?.url)) {
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
        });
    } catch (injectError) {
        console.warn(
            'Unable to inject content script before notifying side panel state.',
            injectError,
        );
        return;
    }

    try {
        await chrome.tabs.sendMessage(tabId, {
            type: SIDEPANEL_STATE_MESSAGE,
            state,
        });
    } catch (error) {
        console.warn('Unable to notify content script about side panel state.', error);
    }
};

const notifyContentSidePanelClosedOnce = () => {
    if (closeSignalSent) return;
    closeSignalSent = true;
    void notifyContentSidePanelState('closed');
};

const startOpenHeartbeat = () => {
    if (openHeartbeatTimer !== null) return;
    void notifyContentSidePanelState('open');
    openHeartbeatTimer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void notifyContentSidePanelState('open');
    }, 1000);
};

const stopOpenHeartbeat = () => {
    if (openHeartbeatTimer === null) return;
    window.clearInterval(openHeartbeatTimer);
    openHeartbeatTimer = null;
};

const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
        closeSignalSent = false;
        startOpenHeartbeat();
        return;
    }
    stopOpenHeartbeat();
    notifyContentSidePanelClosedOnce();
};

const bootstrap = async () => {
    console.log('Side panel script loaded');
    injectStyles();
    ownerTabId = await getActiveTabId();
    closeSignalSent = false;

    const mountPoint = document.getElementById('sidepanel-root');
    if (!mountPoint) {
        console.error('Side panel mount root not found.');
        return;
    }

    const initialState = await readHandoffState();
    mount(mountPoint, {
        hostMode: 'sidepanel',
        initialState,
    });

    window.addEventListener(HANDOFF_EVENT, handleHandoffState as EventListener);
    window.addEventListener(OPEN_OVERLAY_EVENT, handleOpenOverlayRequest as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', notifyContentSidePanelClosedOnce, {
        once: true,
    });
    window.addEventListener('beforeunload', notifyContentSidePanelClosedOnce, {
        once: true,
    });
    if (document.visibilityState === 'visible') {
        startOpenHeartbeat();
    } else {
        void notifyContentSidePanelState('closed');
    }
};

void bootstrap();
