import type { AuthRole, AuthUser } from './types.js';

/** Refresh the access token when it is within this skew of its expiry. */
export const REFRESH_SKEW_MS = 60_000;

const AUTH_ROLES: readonly AuthRole[] = ['admin_app', 'admin_org', 'editor', 'guest'];

/**
 * Decode the `exp` claim (seconds) of a JWT and return it in milliseconds.
 * Returns `null` for malformed tokens or a missing/invalid `exp`.
 *
 * Uses `atob` for base64url decoding so it runs in browsers, extension service
 * workers, and Node 18+ (which exposes a global `atob`).
 */
export const decodeJwtExpMs = (token: string): number | null => {
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

/**
 * `true` when the access token is missing or within `REFRESH_SKEW_MS` of
 * expiry (i.e. a refresh should be attempted). Accepts an ISO string or epoch
 * milliseconds.
 */
export const isExpiringSoon = (
    expiresAt: string | number | null | undefined,
): boolean => {
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

/**
 * Normalize a raw user payload into a strict {@link AuthUser}, or `null` when
 * the id is empty or the role is not one of the four known roles.
 */
export const normalizeUser = (
    payload:
        | (Omit<Partial<AuthUser>, 'role'> & { id?: string | null; role?: string | null })
        | null
        | undefined,
): AuthUser | null => {
    const id = String(payload?.id ?? '').trim();
    const role = String(payload?.role ?? '').trim();
    if (!id) return null;
    if (!AUTH_ROLES.includes(role as AuthRole)) return null;
    return {
        id,
        role: role as AuthRole,
        email: payload?.email ?? null,
        displayName: payload?.displayName ?? null,
    };
};
