/**
 * Entry point for the ChatWidget in the Chrome Extension.
 * This file is bundled as `chatwidget.js`.
 */

import '../src/app.css';
import ChatWidget from '$lib/components/ChatWidget.svelte';
import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { initApiClient } from '$lib/core/api-client';
import { createExtensionContextProvider } from '$lib/core/context-provider';
import { clearUser } from '$lib/stores/session';
import { loadExtensionConfig, type ExtensionRuntimeConfig } from './extension-config';
import { installOverlayFetchProxy } from './network-bridge';
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

const EXTENSION_CONFIG_UPDATED_EVENT = 'topai:extension-config-updated';

/**
 * Mounts the ChatWidget into the target element.
 */
export function mount(target: Element, options: ChatWidgetMountOptions = {}) {
    void (async () => {
        const hostMode = options.hostMode ?? 'overlay';
        const runtimeConfig = await loadExtensionConfig();

        const applyRuntimeConfig = (config: Pick<ExtensionRuntimeConfig, 'apiBaseUrl'>) => {
            initApiClient({
                baseUrl: config.apiBaseUrl,
                isBrowser: true,
            });

            // Route extension API calls through the background proxy in both overlay and sidepanel
            // to attach dedicated extension auth tokens consistently.
            installOverlayFetchProxy(config.apiBaseUrl);
        };

        applyRuntimeConfig(runtimeConfig);

        // Use the extension context provider
        const contextProvider = createExtensionContextProvider();

        mountSvelte(ChatWidget, {
            target: target as HTMLElement,
            props: {
                contextProvider,
                hostMode,
                initialState: options.initialState ?? null,
            },
        });

        const onConfigUpdated = (event: Event) => {
            const detail = (event as CustomEvent<Partial<ExtensionRuntimeConfig>>).detail;
            if (!detail?.apiBaseUrl) return;
            applyRuntimeConfig({
                apiBaseUrl: detail.apiBaseUrl,
            });
        };
        window.addEventListener(EXTENSION_CONFIG_UPDATED_EVENT, onConfigUpdated);

        // In extension context, authentication starts from explicit user action.
        // Keep the store out of loading state until user connects.
        clearUser();
    })();
}

// Keep a global fallback to tolerate bundlers that drop entry exports.
const globalMountKey = '__topAiIdeasMountChatWidget';
(globalThis as typeof globalThis & { [key: string]: unknown })[globalMountKey] = mount;

export default { mount };
