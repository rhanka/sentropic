import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { CHATWIDGET_HANDOFF_STORAGE_KEY } from '$lib/core/chatwidget-handoff';
import { mount } from './chatwidget-entry';

const HANDOFF_EVENT = 'topai:chatwidget-handoff-state';

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

const bootstrap = async () => {
    console.log('Side panel script loaded');
    injectStyles();

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
};

void bootstrap();
