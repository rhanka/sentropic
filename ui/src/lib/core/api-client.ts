/**
 * API Client — Abstraction layer for API calls, decoupled from SvelteKit's $app/environment.
 *
 * In SvelteKit: uses API_BASE_URL from config.ts (Vite env) and `browser` from $app/environment.
 * In Chrome Extension: uses a configurable baseUrl (from chrome.storage or popup config).
 *
 * This module re-exports the existing api.ts functions but provides the configuration
 * injection point needed for the extension. The existing api.ts is wrapped, not replaced,
 * to avoid breaking the web app.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiClientConfig {
    /** Base URL for the API (e.g. "https://top-ai-ideas-api.sent-tech.ca/api/v1") */
    baseUrl: string;
    /** Whether we're in a browser environment (always true in extension) */
    isBrowser?: boolean;
    /** Optional: returns the current scoped workspace ID */
    getWorkspaceId?: () => string | null;
}

// ---------------------------------------------------------------------------
// Singleton config — set once at bootstrap, used by api.ts
// ---------------------------------------------------------------------------

let _config: ApiClientConfig | null = null;

/**
 * Initialize the API client configuration.
 * Call this once at app bootstrap (SvelteKit layout or extension content script).
 *
 * If not called, the existing `api.ts` behaviour is unchanged (uses $app defaults).
 */
export function initApiClient(config: ApiClientConfig): void {
    _config = config;
}

/**
 * Get the current API client configuration.
 * Returns `null` if not initialized (web app default path).
 */
export function getApiClientConfig(): ApiClientConfig | null {
    return _config;
}

/**
 * Get the configured API base URL (or null if not initialized via initApiClient).
 * Used by api.ts to override the default Vite-based API_BASE_URL.
 */
export function getApiBaseUrl(): string | null {
    return _config?.baseUrl ?? null;
}

/**
 * Get the configured isBrowser flag (or null if not initialized via initApiClient).
 * Used by api.ts to override the SvelteKit `browser` import.
 */
export function getApiBrowserFlag(): boolean | null {
    return _config?.isBrowser ?? null;
}
