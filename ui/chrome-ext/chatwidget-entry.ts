/**
 * Entry point for the ChatWidget in the Chrome Extension.
 * This file is bundled as `chatwidget.js`.
 */

import '../src/app.css';
import ChatWidget from '$lib/components/ChatWidget.svelte';
import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { createExtensionContextProvider } from '$lib/core/context-provider';
import { init as initI18n, register } from 'svelte-i18n';
import { mount as mountSvelte } from 'svelte';

// Import locales
import en from '../src/locales/en.json';
import fr from '../src/locales/fr.json';

// Initialize i18n
register('en', () => Promise.resolve(en));
register('fr', () => Promise.resolve(fr));

const browserLocale = chrome.i18n.getUILanguage().split('-')[0];
initI18n({
    fallbackLocale: 'fr',
    initialLocale: browserLocale === 'en' ? 'en' : 'fr'
});

export type ChatWidgetMountOptions = {
    hostMode?: 'overlay' | 'sidepanel';
    initialState?: ChatWidgetHandoffState | null;
};

/**
 * Mounts the ChatWidget into the target element.
 */
export function mount(target: Element, options: ChatWidgetMountOptions = {}) {
    // Use the extension context provider
    const contextProvider = createExtensionContextProvider();

    mountSvelte(ChatWidget, {
        target: target as HTMLElement,
        props: {
            contextProvider,
            hostMode: options.hostMode ?? 'overlay',
            initialState: options.initialState ?? null,
        },
    });
}

// Keep a global fallback to tolerate bundlers that drop entry exports.
const globalMountKey = '__topAiIdeasMountChatWidget';
(globalThis as typeof globalThis & { [key: string]: unknown })[globalMountKey] = mount;

export default { mount };
