import type { StorageAdapter } from './storage-adapter.js';
import { decodeJwtExpMs, isExpiringSoon, normalizeUser } from './token.js';
import type {
    AuthConnectResult,
    AuthSessionState,
    AuthStatus,
    AuthUser,
    SessionInfoResponse,
    TokenIssueResponse,
} from './types.js';

/** Minimal `fetch` signature so hosts can inject a Node or browser fetch. */
export type FetchLike = (
    input: string,
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        credentials?: 'include' | 'omit' | 'same-origin';
    },
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

/** Host configuration for the session-auth client. */
export type SessionAuthConfig = {
    /** API base URL, e.g. `https://api.example.com/api/v1`. */
    apiBaseUrl: string;
    /** App base URL, used to build the login URL when an app session is required. */
    appBaseUrl?: string;
    /** Device name sent on `extension-token` enrollment. */
    deviceName?: string;
};

export type SessionAuthDeps = {
    storage: StorageAdapter;
    fetch: FetchLike;
    config: SessionAuthConfig;
};

const DEFAULT_DEVICE_NAME = 'Sentropic Client';

/**
 * Portable Sentropic session/token lifecycle, extracted from the Chrome
 * extension's `extension-auth.ts`. Storage is abstracted behind a
 * {@link StorageAdapter}; `fetch` is injected. Behavior mirrors the extension
 * byte-for-byte (refresh-on-skew, single-flight clear on failure, fresh-user
 * re-fetch after refresh).
 */
export class SessionAuthClient {
    private readonly storage: StorageAdapter;
    private readonly fetch: FetchLike;
    private readonly config: SessionAuthConfig;

    constructor(deps: SessionAuthDeps) {
        this.storage = deps.storage;
        this.fetch = deps.fetch;
        this.config = deps.config;
    }

    private async clearAll(): Promise<void> {
        await Promise.all([this.storage.clearPersistent(), this.storage.clearSession()]);
    }

    private async fetchSessionUser(accessToken: string): Promise<AuthUser | null> {
        const response = await this.fetch(`${this.config.apiBaseUrl}/auth/session`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) return null;
        const data = (await response.json()) as SessionInfoResponse;
        return normalizeUser({
            id: data.userId,
            role: data.role,
            email: data.email ?? null,
            displayName: data.displayName ?? null,
        });
    }

    private async saveIssuedTokens(
        issued: TokenIssueResponse,
        fallbackUser: AuthUser | null,
    ): Promise<{ user: AuthUser; expiresAt: string } | null> {
        const sessionToken = String(issued.sessionToken ?? '').trim();
        const refreshToken = String(issued.refreshToken ?? '').trim();
        if (!sessionToken || !refreshToken) return null;

        const expiresAt = String(issued.expiresAt ?? '').trim();
        const derivedExpMs = decodeJwtExpMs(sessionToken);
        const effectiveExpiresAt =
            expiresAt && Number.isFinite(Date.parse(expiresAt))
                ? new Date(expiresAt).toISOString()
                : derivedExpMs
                    ? new Date(derivedExpMs).toISOString()
                    : null;

        if (!effectiveExpiresAt) return null;

        const normalizedIssuedUser = normalizeUser(issued.user ?? {});
        const user = normalizedIssuedUser ?? fallbackUser;
        if (!user) return null;

        await this.storage.writePersistent({
            refreshToken,
            user,
            updatedAt: Date.now(),
        });

        await this.storage.writeSession({
            sessionToken,
            expiresAt: effectiveExpiresAt,
            user,
            updatedAt: Date.now(),
        });

        return { user, expiresAt: effectiveExpiresAt };
    }

    private async refreshWithStoredToken(): Promise<
        { token: string; user: AuthUser; expiresAt: string } | null
    > {
        const persistent = await this.storage.readPersistent();
        if (!persistent?.refreshToken) return null;

        let refreshResponse: { ok: boolean; status: number; json: () => Promise<unknown> };
        try {
            refreshResponse = await this.fetch(`${this.config.apiBaseUrl}/auth/session/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refreshToken: persistent.refreshToken }),
            });
        } catch {
            return null;
        }

        if (!refreshResponse.ok) {
            await this.clearAll();
            return null;
        }

        const issued = (await refreshResponse.json()) as TokenIssueResponse;
        const saved = await this.saveIssuedTokens(issued, persistent.user);
        if (!saved) {
            await this.clearAll();
            return null;
        }

        const session = await this.storage.readSession();
        if (!session?.sessionToken) {
            await this.clearAll();
            return null;
        }

        const freshUser = await this.fetchSessionUser(session.sessionToken);
        if (freshUser) {
            await this.storage.writePersistent({
                refreshToken: persistent.refreshToken,
                user: freshUser,
                updatedAt: Date.now(),
            });
            await this.storage.writeSession({
                ...session,
                user: freshUser,
                updatedAt: Date.now(),
            });
            return {
                token: session.sessionToken,
                user: freshUser,
                expiresAt: session.expiresAt,
            };
        }

        return {
            token: session.sessionToken,
            user: session.user,
            expiresAt: session.expiresAt,
        };
    }

    /** Return a valid access token, refreshing on skew unless `allowRefresh` is false. */
    async getValidAccessToken(options?: { allowRefresh?: boolean }): Promise<string | null> {
        const allowRefresh = options?.allowRefresh !== false;
        const session = await this.storage.readSession();
        if (session?.sessionToken && !isExpiringSoon(session.expiresAt)) {
            return session.sessionToken;
        }

        if (!allowRefresh) return null;
        const refreshed = await this.refreshWithStoredToken();
        return refreshed?.token ?? null;
    }

    /** Resolve the connection status, re-validating the user against the API. */
    async getStatus(options?: { allowRefresh?: boolean }): Promise<AuthStatus> {
        const token = await this.getValidAccessToken(options);
        if (!token) {
            return {
                connected: false,
                reason: 'Client is not connected. Use Connect to authenticate.',
            };
        }

        const user = await this.fetchSessionUser(token);
        if (!user) {
            await this.clearAll();
            return {
                connected: false,
                reason: 'Client session is invalid. Please reconnect.',
            };
        }

        const session = await this.storage.readSession();
        const expiresAt =
            session?.expiresAt && Number.isFinite(Date.parse(session.expiresAt))
                ? session.expiresAt
                : new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const persistent = await this.storage.readPersistent();
        if (persistent?.refreshToken) {
            await this.storage.writePersistent({
                refreshToken: persistent.refreshToken,
                user,
                updatedAt: Date.now(),
            });
        }
        await this.storage.writeSession({
            sessionToken: token,
            expiresAt,
            user,
            updatedAt: Date.now(),
        } satisfies AuthSessionState);

        return {
            connected: true,
            user,
            expiresAt,
        };
    }

    /** Enroll via `POST /auth/session/extension-token` (needs an app session cookie). */
    async connect(): Promise<AuthConnectResult> {
        if (!this.config.apiBaseUrl || !this.config.appBaseUrl) {
            return {
                ok: false,
                code: 'CONFIG_INVALID',
                error: 'Missing API/App base URL in client configuration.',
            };
        }

        let response: { ok: boolean; status: number; json: () => Promise<unknown> };
        try {
            response = await this.fetch(`${this.config.apiBaseUrl}/auth/session/extension-token`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    deviceName: this.config.deviceName ?? DEFAULT_DEVICE_NAME,
                }),
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                code: 'CONNECT_FAILED',
                error: `Failed to connect client auth: ${reason}`,
            };
        }

        if (response.status === 401 || response.status === 403) {
            return {
                ok: false,
                code: 'APP_SESSION_REQUIRED',
                error: 'App session is missing or expired. Please sign in to the app first.',
                loginUrl: `${this.config.appBaseUrl.replace(/\/$/, '')}/auth/login`,
            };
        }

        if (!response.ok) {
            const errorPayload = (await response.json().catch(() => ({}))) as {
                error?: string;
                message?: string;
            };
            const reason = errorPayload?.message || errorPayload?.error || `HTTP ${response.status}`;
            return {
                ok: false,
                code: 'CONNECT_FAILED',
                error: reason,
            };
        }

        const issued = (await response.json()) as TokenIssueResponse;
        const saved = await this.saveIssuedTokens(issued, normalizeUser(issued.user ?? {}));
        if (!saved) {
            await this.clearAll();
            return {
                ok: false,
                code: 'CONNECT_FAILED',
                error: 'Received invalid token payload from API.',
            };
        }

        return {
            ok: true,
            user: saved.user,
            expiresAt: saved.expiresAt,
        };
    }

    /** Revoke the session (`DELETE /auth/session`) best-effort, then clear local state. */
    async logout(): Promise<void> {
        const token = await this.getValidAccessToken({ allowRefresh: false });
        if (token) {
            try {
                await this.fetch(`${this.config.apiBaseUrl}/auth/session`, {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });
            } catch {
                // Best effort revoke, local clear still required.
            }
        }
        await this.clearAll();
    }
}
