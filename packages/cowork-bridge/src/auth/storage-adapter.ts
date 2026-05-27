import type { AuthPersistentState, AuthSessionState } from './types.js';

/**
 * Storage seam for the portable auth lifecycle.
 *
 * Splits durable state (refresh token, survives restarts) from session state
 * (access token, may be cleared aggressively). Each host supplies its own
 * implementation:
 * - Chrome extension: `chrome.storage.local` (persistent) + `chrome.storage.session` (session).
 * - Cowork desktop binary: an OS credential store / protected file (persistent) + in-memory (session).
 *
 * All methods are async to accommodate the Chrome `storage` Promise API.
 */
export interface StorageAdapter {
    readPersistent(): Promise<AuthPersistentState | null>;
    writePersistent(state: AuthPersistentState): Promise<void>;
    clearPersistent(): Promise<void>;

    readSession(): Promise<AuthSessionState | null>;
    writeSession(state: AuthSessionState): Promise<void>;
    clearSession(): Promise<void>;
}
