import type {
    AuthPersistentState,
    AuthSessionState,
    StorageAdapter,
} from '@sentropic/cowork-bridge/auth';
import { normalizeUser } from '@sentropic/cowork-bridge/auth';

/**
 * Chrome-specific {@link StorageAdapter}: persistent state lives in
 * `chrome.storage.local`, session state in `chrome.storage.session`.
 */
const EXTENSION_AUTH_PERSISTENT_KEY = 'sentropic:extensionAuth:v1';
const EXTENSION_AUTH_SESSION_KEY = 'sentropic:extensionAuthSession:v1';

export const createChromeStorageAdapter = (): StorageAdapter => ({
    async readPersistent(): Promise<AuthPersistentState | null> {
        try {
            const payload = await chrome.storage.local.get(EXTENSION_AUTH_PERSISTENT_KEY);
            const raw = payload?.[EXTENSION_AUTH_PERSISTENT_KEY] as
                | AuthPersistentState
                | undefined;
            if (!raw?.refreshToken) return null;
            const user = normalizeUser(raw.user ?? {});
            if (!user) return null;
            return {
                refreshToken: raw.refreshToken,
                user,
                updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
            };
        } catch {
            return null;
        }
    },

    async writePersistent(state: AuthPersistentState): Promise<void> {
        await chrome.storage.local.set({
            [EXTENSION_AUTH_PERSISTENT_KEY]: state,
        });
    },

    async clearPersistent(): Promise<void> {
        await chrome.storage.local.remove(EXTENSION_AUTH_PERSISTENT_KEY);
    },

    async readSession(): Promise<AuthSessionState | null> {
        try {
            const payload = await chrome.storage.session.get(EXTENSION_AUTH_SESSION_KEY);
            const raw = payload?.[EXTENSION_AUTH_SESSION_KEY] as AuthSessionState | undefined;
            if (!raw?.sessionToken || !raw?.expiresAt) return null;
            const user = normalizeUser(raw.user ?? {});
            if (!user) return null;
            return {
                sessionToken: raw.sessionToken,
                expiresAt: raw.expiresAt,
                user,
                updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
            };
        } catch {
            return null;
        }
    },

    async writeSession(state: AuthSessionState): Promise<void> {
        await chrome.storage.session.set({
            [EXTENSION_AUTH_SESSION_KEY]: state,
        });
    },

    async clearSession(): Promise<void> {
        await chrome.storage.session.remove(EXTENSION_AUTH_SESSION_KEY);
    },
});
