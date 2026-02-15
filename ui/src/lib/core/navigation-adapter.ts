/**
 * Navigation Adapter — Abstraction layer for SvelteKit's $app/navigation (goto).
 *
 * In SvelteKit: wraps the real `goto` function.
 * In Chrome Extension: uses `window.open` or `chrome.tabs.create`.
 *
 * This allows session.ts and other modules to navigate without direct SvelteKit dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavigationAdapter {
    /** Navigate to a URL (replaces SvelteKit's `goto`). */
    goto(url: string): void;
}

// ---------------------------------------------------------------------------
// Singleton — set once at bootstrap
// ---------------------------------------------------------------------------

let _adapter: NavigationAdapter | null = null;

/**
 * Initialize the navigation adapter.
 * Call this once at app bootstrap.
 *
 * In SvelteKit:
 * ```ts
 * import { goto } from '$app/navigation';
 * import { initNavigation, createSvelteKitNavigation } from '$lib/core/navigation-adapter';
 * initNavigation(createSvelteKitNavigation(goto));
 * ```
 *
 * In Chrome Extension:
 * ```ts
 * import { initNavigation, createExtensionNavigation } from '$lib/core/navigation-adapter';
 * initNavigation(createExtensionNavigation());
 * ```
 */
export function initNavigation(adapter: NavigationAdapter): void {
    _adapter = adapter;
}

/**
 * Get the current navigation adapter, or a fallback that uses window.location.
 */
export function getNavigation(): NavigationAdapter {
    if (_adapter) return _adapter;
    // Fallback: direct navigation (works everywhere)
    return {
        goto(url: string) {
            if (typeof window !== 'undefined') {
                window.location.href = url;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a NavigationAdapter wrapping SvelteKit's `goto`.
 */
export function createSvelteKitNavigation(
    gotoFn: (url: string) => Promise<void>
): NavigationAdapter {
    return {
        goto(url: string) {
            void gotoFn(url);
        },
    };
}

/**
 * Create a NavigationAdapter for the Chrome Extension.
 * Opens URLs in a new tab (login page, etc.).
 *
 * @param apiBaseUrl - Used to convert relative URLs (e.g. "/auth/login") to absolute ones.
 */
export function createExtensionNavigation(apiBaseUrl?: string): NavigationAdapter {
    return {
        goto(url: string) {
            // Convert relative URLs to absolute using the API domain
            let absoluteUrl = url;
            if (url.startsWith('/') && apiBaseUrl) {
                // Strip /api/v1 suffix to get the base domain
                const baseOrigin = new URL(apiBaseUrl).origin;
                absoluteUrl = `${baseOrigin}${url}`;
            }

            // Prefer Chrome API when available, fallback to window.open
            if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                void chrome.tabs.create({ url: absoluteUrl });
            } else if (typeof window !== 'undefined') {
                window.open(absoluteUrl, '_blank');
            }
        },
    };
}
