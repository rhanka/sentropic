/**
 * Portable auth types for the Sentropic session/token lifecycle.
 *
 * These types are extracted verbatim from the Chrome extension's
 * `extension-auth.ts` so the web app, the extension, and the Cowork desktop
 * binary share one contract. They carry no Chrome- or SvelteKit-specific shape.
 */

/** The four Sentropic roles, as returned by `/auth/session`. */
export type AuthRole = 'admin_app' | 'admin_org' | 'editor' | 'guest';

/** Normalized authenticated user, host-agnostic. */
export type AuthUser = {
    id: string;
    email: string | null;
    displayName: string | null;
    role: AuthRole;
};

/** Persistent (long-lived) auth state: the refresh token + last-known user. */
export type AuthPersistentState = {
    refreshToken: string;
    user: AuthUser;
    updatedAt: number;
};

/** Session (short-lived) auth state: the access token + its expiry. */
export type AuthSessionState = {
    sessionToken: string;
    expiresAt: string;
    user: AuthUser;
    updatedAt: number;
};

/** Raw token-issue response from `extension-token` / `refresh`. */
export type TokenIssueResponse = {
    success?: boolean;
    user?: Partial<AuthUser> | null;
    sessionToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    error?: string;
};

/** Raw `/auth/session` info response. */
export type SessionInfoResponse = {
    userId: string;
    role: string;
    email?: string | null;
    displayName?: string | null;
};

/** Connection status surfaced to the host UI/tray. */
export type AuthStatus =
    | {
        connected: true;
        user: AuthUser;
        expiresAt: string;
    }
    | {
        connected: false;
        reason: string;
    };

/** Result of an `extension-token` enrollment attempt. */
export type AuthConnectResult =
    | {
        ok: true;
        user: AuthUser;
        expiresAt: string;
    }
    | {
        ok: false;
        code: 'APP_SESSION_REQUIRED' | 'CONFIG_INVALID' | 'CONNECT_FAILED';
        error: string;
        loginUrl?: string;
    };
