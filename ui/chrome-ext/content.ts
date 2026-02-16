// Top AI Ideas Extension - Content Script
// Bootstraps the ChatWidget inside a Shadow DOM to avoid CSS conflicts.

import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { CHATWIDGET_HANDOFF_STORAGE_KEY } from '$lib/core/chatwidget-handoff';
import type { ChatWidgetMountOptions } from './chatwidget-entry';

console.log('Top AI Ideas Content Script loading...');

const HANDOFF_EVENT = 'topai:chatwidget-handoff-state';
const OPEN_SIDEPANEL_EVENT = 'topai:open-sidepanel';
const OPEN_CHAT_EVENT = 'topai:open-chat';
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    'top-ai-ideas.sent-tech.ca',
    'app.sent-tech.ca',
]);

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

const openSidePanel = async () => {
    try {
        await chrome.runtime.sendMessage({ type: 'open_side_panel' });
    } catch (error) {
        console.error('Failed to request side panel opening.', error);
    }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'open_overlay_chat') return;
    const activeTab = message?.activeTab as 'chat' | 'queue' | 'comments' | undefined;
    window.dispatchEvent(
        new CustomEvent(OPEN_CHAT_EVENT, {
            detail: {
                activeTab,
            },
        }),
    );
    sendResponse?.({ ok: true });
    return true;
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
