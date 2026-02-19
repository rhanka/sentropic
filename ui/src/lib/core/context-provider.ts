/**
 * Context Provider — Abstraction layer for SvelteKit's $app/stores (page) and $app/environment (browser).
 *
 * In SvelteKit: wraps the real `page` store and `browser` constant.
 * In Chrome Extension: provides a static or externally-driven context (no SvelteKit routing).
 *
 * This allows ChatWidget and other components to remain agnostic of the runtime environment.
 */

import { writable, type Readable } from 'svelte/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of SvelteKit's Page store that ChatWidget actually uses. */
export interface AppContext {
    route: { id: string | null };
    params: Record<string, string>;
    url: URL;
}

export interface ContextProvider {
    /** Reactive store providing the current navigation/page context. */
    readonly context: Readable<AppContext>;
    /** `true` when running in a browser (always true in extension). */
    readonly isBrowser: boolean;
}

// ---------------------------------------------------------------------------
// SvelteKit implementation (default for the web app)
// ---------------------------------------------------------------------------

/**
 * Create a ContextProvider backed by SvelteKit's `$app/stores` page store.
 *
 * Usage (in SvelteKit layout/component):
 * ```ts
 * import { page } from '$app/stores';
 * import { browser } from '$app/environment';
 * import { createSvelteKitContextProvider } from '$lib/core/context-provider';
 *
 * const ctx = createSvelteKitContextProvider(page, browser);
 * ```
 */
export function createSvelteKitContextProvider(
    pageStore: Readable<AppContext>,
    isBrowser: boolean
): ContextProvider {
    return {
        context: pageStore,
        isBrowser,
    };
}

// ---------------------------------------------------------------------------
// Chrome Extension implementation
// ---------------------------------------------------------------------------

/**
 * Create a ContextProvider for the Chrome Extension environment.
 *
 * The extension has no SvelteKit routing — the context is static or driven
 * by the service worker / content script.
 */
export function createExtensionContextProvider(
    overrides?: Partial<AppContext>
): ContextProvider {
    const defaultUrl = typeof window !== 'undefined'
        ? new URL(window.location.href)
        : new URL('chrome-extension://localhost');

    const store = writable<AppContext>({
        route: { id: overrides?.route?.id ?? null },
        params: overrides?.params ?? {},
        url: overrides?.url ?? defaultUrl,
    });

    return {
        context: { subscribe: store.subscribe },
        isBrowser: true,
    };
}
