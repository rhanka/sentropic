import type { ExtensionRuntimeConfig } from './extension-config';

export type ExtensionAuthUser = {
    id: string;
    email: string | null;
    displayName: string | null;
    role: 'admin_app' | 'admin_org' | 'editor' | 'guest';
};

type ExtensionAuthPersistentState = {
    refreshToken: string;
    user: ExtensionAuthUser;
    updatedAt: number;
};

type ExtensionAuthSessionState = {
    sessionToken: string;
    expiresAt: string;
    user: ExtensionAuthUser;
    updatedAt: number;
};

type TokenIssueResponse = {
    success?: boolean;
    user?: ExtensionAuthUser;
    sessionToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    error?: string;
};

type SessionInfoResponse = {
    userId: string;
    role: 'admin_app' | 'admin_org' | 'editor' | 'guest';
    email?: string | null;
    displayName?: string | null;
};

export type ExtensionAuthStatus =
    | {
        connected: true;
        user: ExtensionAuthUser;
        expiresAt: string;
    }
    | {
        connected: false;
        reason: string;
    };

export type ExtensionAuthConnectResult =
    | {
        ok: true;
        user: ExtensionAuthUser;
        expiresAt: string;
    }
    | {
        ok: false;
        code: 'APP_SESSION_REQUIRED' | 'CONFIG_INVALID' | 'CONNECT_FAILED';
        error: string;
        loginUrl?: string;
    };

const EXTENSION_AUTH_PERSISTENT_KEY = 'topAiIdeas:extensionAuth:v1';
const EXTENSION_AUTH_SESSION_KEY = 'topAiIdeas:extensionAuthSession:v1';
const REFRESH_SKEW_MS = 60_000;

const decodeJwtExpMs = (token: string): number | null => {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padding = payloadB64.length % 4;
        const normalized = padding === 0 ? payloadB64 : payloadB64 + '='.repeat(4 - padding);
        const payloadRaw = atob(normalized);
        const payload = JSON.parse(payloadRaw) as { exp?: number };
        if (!payload?.exp || !Number.isFinite(payload.exp)) return null;
        return payload.exp * 1000;
    } catch {
        return null;
    }
};

const isExpiringSoon = (expiresAt: string | number | null | undefined): boolean => {
    if (!expiresAt) return true;
    const ms =
        typeof expiresAt === 'number'
            ? expiresAt
            : Number.isFinite(Date.parse(expiresAt))
                ? Date.parse(expiresAt)
                : null;
    if (!ms) return true;
    return ms - Date.now() <= REFRESH_SKEW_MS;
};

const normalizeUser = (
    payload: Partial<ExtensionAuthUser> & { id?: string | null; role?: string | null },
): ExtensionAuthUser | null => {
    const id = String(payload?.id ?? '').trim();
    const role = String(payload?.role ?? '').trim();
    if (!id) return null;
    if (!['admin_app', 'admin_org', 'editor', 'guest'].includes(role)) return null;
    return {
        id,
        role: role as ExtensionAuthUser['role'],
        email: payload?.email ?? null,
        displayName: payload?.displayName ?? null,
    };
};

const readPersistentState = async (): Promise<ExtensionAuthPersistentState | null> => {
    try {
        const payload = await chrome.storage.local.get(EXTENSION_AUTH_PERSISTENT_KEY);
        const raw = payload?.[EXTENSION_AUTH_PERSISTENT_KEY] as ExtensionAuthPersistentState | undefined;
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
};

const writePersistentState = async (state: ExtensionAuthPersistentState): Promise<void> => {
    await chrome.storage.local.set({
        [EXTENSION_AUTH_PERSISTENT_KEY]: state,
    });
};

const clearPersistentState = async (): Promise<void> => {
    await chrome.storage.local.remove(EXTENSION_AUTH_PERSISTENT_KEY);
};

const readSessionState = async (): Promise<ExtensionAuthSessionState | null> => {
    try {
        const payload = await chrome.storage.session.get(EXTENSION_AUTH_SESSION_KEY);
        const raw = payload?.[EXTENSION_AUTH_SESSION_KEY] as ExtensionAuthSessionState | undefined;
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
};

const writeSessionState = async (state: ExtensionAuthSessionState): Promise<void> => {
    await chrome.storage.session.set({
        [EXTENSION_AUTH_SESSION_KEY]: state,
    });
};

const clearSessionState = async (): Promise<void> => {
    await chrome.storage.session.remove(EXTENSION_AUTH_SESSION_KEY);
};

const fetchSessionUser = async (
    config: ExtensionRuntimeConfig,
    accessToken: string,
): Promise<ExtensionAuthUser | null> => {
    const response = await fetch(`${config.apiBaseUrl}/auth/session`, {
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
};

const saveIssuedTokens = async (
    issued: TokenIssueResponse,
    fallbackUser: ExtensionAuthUser | null,
): Promise<{ user: ExtensionAuthUser; expiresAt: string } | null> => {
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

    await writePersistentState({
        refreshToken,
        user,
        updatedAt: Date.now(),
    });

    await writeSessionState({
        sessionToken,
        expiresAt: effectiveExpiresAt,
        user,
        updatedAt: Date.now(),
    });

    return { user, expiresAt: effectiveExpiresAt };
};

const clearAllAuthState = async (): Promise<void> => {
    await Promise.all([clearPersistentState(), clearSessionState()]);
};

const refreshWithStoredToken = async (
    config: ExtensionRuntimeConfig,
): Promise<{ token: string; user: ExtensionAuthUser; expiresAt: string } | null> => {
    const persistent = await readPersistentState();
    if (!persistent?.refreshToken) return null;

    let refreshResponse: Response;
    try {
        refreshResponse = await fetch(`${config.apiBaseUrl}/auth/session/refresh`, {
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
        await clearAllAuthState();
        return null;
    }

    const issued = (await refreshResponse.json()) as TokenIssueResponse;
    const saved = await saveIssuedTokens(issued, persistent.user);
    if (!saved) {
        await clearAllAuthState();
        return null;
    }

    const session = await readSessionState();
    if (!session?.sessionToken) {
        await clearAllAuthState();
        return null;
    }

    const freshUser = await fetchSessionUser(config, session.sessionToken);
    if (freshUser) {
        await writePersistentState({
            refreshToken: persistent.refreshToken,
            user: freshUser,
            updatedAt: Date.now(),
        });
        await writeSessionState({
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
};

export const getValidAccessToken = async (
    config: ExtensionRuntimeConfig,
    options?: { allowRefresh?: boolean },
): Promise<string | null> => {
    const allowRefresh = options?.allowRefresh !== false;
    const session = await readSessionState();
    if (session?.sessionToken && !isExpiringSoon(session.expiresAt)) {
        return session.sessionToken;
    }

    if (!allowRefresh) return null;
    const refreshed = await refreshWithStoredToken(config);
    return refreshed?.token ?? null;
};

export const getExtensionAuthStatus = async (
    config: ExtensionRuntimeConfig,
    options?: { allowRefresh?: boolean },
): Promise<ExtensionAuthStatus> => {
    const token = await getValidAccessToken(config, options);
    if (!token) {
        return {
            connected: false,
            reason: 'Extension is not connected. Use Connect to authenticate.',
        };
    }

    const user = await fetchSessionUser(config, token);
    if (!user) {
        await clearAllAuthState();
        return {
            connected: false,
            reason: 'Extension session is invalid. Please reconnect.',
        };
    }

    const session = await readSessionState();
    const expiresAt =
        session?.expiresAt && Number.isFinite(Date.parse(session.expiresAt))
            ? session.expiresAt
            : new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const persistent = await readPersistentState();
    if (persistent?.refreshToken) {
        await writePersistentState({
            refreshToken: persistent.refreshToken,
            user,
            updatedAt: Date.now(),
        });
    }
    await writeSessionState({
        sessionToken: token,
        expiresAt,
        user,
        updatedAt: Date.now(),
    });

    return {
        connected: true,
        user,
        expiresAt,
    };
};

export const connectExtensionAuth = async (
    config: ExtensionRuntimeConfig,
): Promise<ExtensionAuthConnectResult> => {
    if (!config.apiBaseUrl || !config.appBaseUrl) {
        return {
            ok: false,
            code: 'CONFIG_INVALID',
            error: 'Missing API/App base URL in extension configuration.',
        };
    }

    let response: Response;
    try {
        response = await fetch(`${config.apiBaseUrl}/auth/session/extension-token`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                deviceName: 'Top AI Ideas Extension',
            }),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            code: 'CONNECT_FAILED',
            error: `Failed to connect extension auth: ${reason}`,
        };
    }

    if (response.status === 401 || response.status === 403) {
        return {
            ok: false,
            code: 'APP_SESSION_REQUIRED',
            error: 'App session is missing or expired. Please sign in to the app first.',
            loginUrl: `${config.appBaseUrl.replace(/\/$/, '')}/auth/login`,
        };
    }

    if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        const reason = errorPayload?.message || errorPayload?.error || `HTTP ${response.status}`;
        return {
            ok: false,
            code: 'CONNECT_FAILED',
            error: reason,
        };
    }

    const issued = (await response.json()) as TokenIssueResponse;
    const saved = await saveIssuedTokens(issued, normalizeUser(issued.user ?? {}));
    if (!saved) {
        await clearAllAuthState();
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
};

export const logoutExtensionAuth = async (
    config: ExtensionRuntimeConfig,
): Promise<void> => {
    const token = await getValidAccessToken(config, { allowRefresh: false });
    if (token) {
        try {
            await fetch(`${config.apiBaseUrl}/auth/session`, {
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
    await clearAllAuthState();
};
