// Top AI Ideas Extension - Content Script
// Bootstraps the ChatWidget inside a Shadow DOM to avoid CSS conflicts.

import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import type { ChatWidgetMountOptions } from './chatwidget-entry';

console.log('Top AI Ideas Content Script loading...');

const HANDOFF_EVENT = 'topai:chatwidget-handoff-state';
const CHATWIDGET_HANDOFF_STORAGE_KEY = 'topAiIdeas:chatWidgetHandoff:v1';
const OPEN_SIDEPANEL_EVENT = 'topai:open-sidepanel';
const OPEN_CHAT_EVENT = 'topai:open-chat';
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    'top-ai-ideas.sent-tech.ca',
    'app.sent-tech.ca',
]);
type ChatTab = 'chat' | 'queue' | 'comments';
type SidePanelState = 'open' | 'closed';
const SIDEPANEL_HEARTBEAT_TTL_MS = 2500;
let hostContainer: HTMLDivElement | null = null;
let isOverlaySuppressed = false;
let panelToOverlaySwitchPending = false;
let mountReady = false;
let pendingOpenTab: ChatTab | null = null;
let invalidContextReloadScheduled = false;
let sidePanelLastOpenHeartbeat = 0;

const isBlockedHost = (): boolean => BLOCKED_HOSTNAMES.has(window.location.hostname);

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

const handleHandoffState = (event: Event) => {
    const detail = (event as CustomEvent<ChatWidgetHandoffState>).detail;
    if (!detail) return;
    void writeHandoffState({
        ...detail,
        source: 'content',
        updatedAt: Date.now(),
    });
};

const openSidePanel = async (): Promise<boolean> => {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'open_side_panel',
        }) as { ok?: boolean; error?: string } | undefined;
        if (response?.ok) return true;
        const reason = response?.error ?? 'unknown reason';
        console.error('Failed to request side panel opening:', reason);
        if (reason.includes('Extension context invalidated')) {
            scheduleInvalidContextRecovery();
        }
        return false;
    } catch (error) {
        console.error('Failed to request side panel opening.', error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Extension context invalidated')) {
            scheduleInvalidContextRecovery();
        }
        return false;
    }
};

const scheduleInvalidContextRecovery = () => {
    if (invalidContextReloadScheduled) return;
    invalidContextReloadScheduled = true;
    console.warn(
        'Extension context invalidated. Reloading page to recover content script context.',
    );
    window.setTimeout(() => {
        window.location.reload();
    }, 50);
};

const syncOverlayVisibility = () => {
    if (!hostContainer) return;
    hostContainer.style.display = isOverlaySuppressed ? 'none' : 'block';
};

const requestOpenOverlayChat = (activeTab?: ChatTab) => {
    const targetTab = activeTab ?? 'chat';
    panelToOverlaySwitchPending = true;
    isOverlaySuppressed = false;
    syncOverlayVisibility();
    if (!mountReady) {
        pendingOpenTab = targetTab;
        return;
    }
    window.dispatchEvent(
        new CustomEvent<{ activeTab: ChatTab }>(OPEN_CHAT_EVENT, {
            detail: {
                activeTab: targetTab,
            },
        }),
    );
};

const collapseOverlayToBubble = () => {
    if (!mountReady) return;
    window.dispatchEvent(new CustomEvent('topai:close-chat'));
};

const handleSidePanelState = (state: SidePanelState) => {
    if (state === 'open') {
        sidePanelLastOpenHeartbeat = Date.now();
        if (panelToOverlaySwitchPending) return;
        isOverlaySuppressed = true;
        syncOverlayVisibility();
        collapseOverlayToBubble();
        return;
    }

    isOverlaySuppressed = false;
    syncOverlayVisibility();

    if (panelToOverlaySwitchPending) {
        panelToOverlaySwitchPending = false;
        return;
    }

    collapseOverlayToBubble();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'open_overlay_chat') {
        const activeTab = message?.activeTab as ChatTab | undefined;
        requestOpenOverlayChat(activeTab);
        sendResponse?.({ ok: true });
        return true;
    }

    if (message?.type === 'sidepanel_state') {
        const state = message?.state as SidePanelState | undefined;
        if (state !== 'open' && state !== 'closed') {
            sendResponse?.({ ok: false, error: 'Invalid side panel state payload' });
            return true;
        }
        handleSidePanelState(state);
        sendResponse?.({ ok: true });
        return true;
    }
});

function bootstrap() {
    if (isBlockedHost()) {
        console.log('Top AI Ideas extension skipped for blocked host:', window.location.hostname);
        return;
    }
    if (document.getElementById('top-ai-ideas-ext')) return;

    // Create Shadow DOM container
    const host = document.createElement('div');
    host.id = 'top-ai-ideas-ext';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
    document.body.appendChild(host);
    hostContainer = host;
    syncOverlayVisibility();

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject compiled CSS
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('chatwidget.css');
    shadow.appendChild(style);

    // Mount point
    const mountPoint = document.createElement('div');
    mountPoint.id = 'chat-mount';
    shadow.appendChild(mountPoint);

    window.addEventListener(HANDOFF_EVENT, handleHandoffState as EventListener);
    window.addEventListener(OPEN_SIDEPANEL_EVENT, () => {
        void openSidePanel();
    });

    // Dev/UAT safety: after extension reload, old content-script contexts become invalid.
    // Detect and self-recover instead of keeping a half-broken widget on the page.
    window.setInterval(() => {
        try {
            void chrome.runtime.getURL('');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('Extension context invalidated')) {
                scheduleInvalidContextRecovery();
            }
        }
    }, 2000);

    // If side panel close signal is missed (Chrome UI close), recover to bubble mode
    // using the latest "panel open" heartbeat.
    window.setInterval(() => {
        if (!isOverlaySuppressed) return;
        if (sidePanelLastOpenHeartbeat <= 0) return;
        if (Date.now() - sidePanelLastOpenHeartbeat <= SIDEPANEL_HEARTBEAT_TTL_MS) {
            return;
        }
        handleSidePanelState('closed');
    }, 1000);

    // Load the Svelte app
    // We use dynamic import to load the module which contains the Svelte component
    // This module is built as 'chatwidget.js' by Vite
    (async () => {
        try {
            const src = chrome.runtime.getURL('chatwidget.js');
            const module = await import(src) as {
                mount?: ((target: Element, options?: ChatWidgetMountOptions) => void);
                default?: { mount?: (target: Element, options?: ChatWidgetMountOptions) => void };
            };
            const mountFn =
                module?.mount ??
                module?.default?.mount ??
                (globalThis as typeof globalThis & {
                    __topAiIdeasMountChatWidget?: (target: Element, options?: ChatWidgetMountOptions) => void;
                }).__topAiIdeasMountChatWidget;

            if (mountFn) {
                const initialState = await readHandoffState();
                mountFn(mountPoint, {
                    hostMode: 'overlay',
                    initialState,
                });
                mountReady = true;
                if (pendingOpenTab) {
                    const activeTab = pendingOpenTab;
                    pendingOpenTab = null;
                    window.setTimeout(() => {
                        window.dispatchEvent(
                            new CustomEvent<{ activeTab: ChatTab }>(OPEN_CHAT_EVENT, {
                                detail: {
                                    activeTab,
                                },
                            }),
                        );
                    }, 0);
                }
                console.log('ChatWidget mounted successfully.');
            } else {
                console.error('ChatWidget module loaded but mount function not found.');
            }
        } catch (err) {
            console.error('Failed to load ChatWidget:', err);
        }
    })();
}

// Initialize when idle/ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
