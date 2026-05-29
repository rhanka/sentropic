import type { FetchLike, StorageAdapter } from '@sentropic/cowork-bridge/auth';
import { decodeJwtExpMs, normalizeUser, type AuthUser } from '@sentropic/cowork-bridge/auth';

/**
 * Device-code enrollment client (RFC 8628-style). A headless desktop binary has
 * no browser cookie, so it cannot call `extension-token` directly. Instead it:
 *  1. POST /auth/device/code  → { device_code, user_code, verification_uri, interval, expires_in }
 *  2. shows `user_code` + `verification_uri` to the user (who approves in the web app)
 *  3. POST /auth/device/poll  at `interval`, respecting `slow_down`, until approved
 *  4. on approval, stores the minted token pair via the bridge {@link StorageAdapter}
 *
 * Refresh thereafter is identical to the Chrome plugin via the bridge
 * `SessionAuthClient` (`/auth/session/refresh`).
 */

export interface DeviceCodeStart {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    /** Poll interval in seconds, as advised by the server. */
    intervalSec: number;
    /** Code lifetime in seconds. */
    expiresInSec: number;
}

export type DeviceCodePollResult =
    | { status: 'authorization_pending' }
    | { status: 'slow_down' }
    | { status: 'expired' }
    | { status: 'denied' }
    | { status: 'approved'; user: AuthUser; expiresAt: string };

export interface DeviceCodeClientDeps {
    fetch: FetchLike;
    storage: StorageAdapter;
    /** API base URL, e.g. `https://api.example.com/api/v1`. */
    apiBaseUrl: string;
    /** Device name hint sent on `code`. */
    deviceName?: string;
    /**
     * Sleep function (ms) — injected so tests can drive the poll loop without
     * real timers. Defaults to a real `setTimeout`-based sleep.
     */
    sleep?: (ms: number) => Promise<void>;
    /** Optional clock, injected for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/** Minimum poll interval (s) and the bump applied on each `slow_down`. */
const SLOW_DOWN_BUMP_SEC = 5;

export class DeviceCodeClient {
    private readonly fetch: FetchLike;
    private readonly storage: StorageAdapter;
    private readonly apiBaseUrl: string;
    private readonly deviceName?: string;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;

    constructor(deps: DeviceCodeClientDeps) {
        this.fetch = deps.fetch;
        this.storage = deps.storage;
        this.apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
        this.deviceName = deps.deviceName;
        this.sleep = deps.sleep ?? defaultSleep;
        this.now = deps.now ?? (() => Date.now());
    }

    /** Step 1: request a fresh device code + user code. */
    async start(): Promise<DeviceCodeStart> {
        const response = await this.fetch(`${this.apiBaseUrl}/auth/device/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.deviceName ? { deviceName: this.deviceName } : {}),
        });
        if (!response.ok) {
            throw new Error(`device/code failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
            device_code?: string;
            user_code?: string;
            verification_uri?: string;
            interval?: number;
            expires_in?: number;
        };
        if (!data.device_code || !data.user_code) {
            throw new Error('device/code returned an invalid payload');
        }
        return {
            deviceCode: data.device_code,
            userCode: data.user_code,
            verificationUri: data.verification_uri ?? '/auth/devices/pair',
            intervalSec: Number.isFinite(data.interval) ? Number(data.interval) : 5,
            expiresInSec: Number.isFinite(data.expires_in) ? Number(data.expires_in) : 600,
        };
    }

    /** Single poll of `/auth/device/poll`, mapping the server status to a result. */
    async poll(deviceCode: string): Promise<DeviceCodePollResult> {
        const response = await this.fetch(`${this.apiBaseUrl}/auth/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: deviceCode }),
        });
        if (!response.ok) {
            throw new Error(`device/poll failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
            status?: string;
            sessionToken?: string;
            refreshToken?: string;
            expiresAt?: string;
            user?: Partial<AuthUser> | null;
        };

        switch (data.status) {
            case 'slow_down':
                return { status: 'slow_down' };
            case 'expired':
                return { status: 'expired' };
            case 'denied':
                return { status: 'denied' };
            case 'approved': {
                const saved = await this.persistApproved(data);
                if (!saved) {
                    throw new Error('device/poll approval returned an invalid token payload');
                }
                return { status: 'approved', user: saved.user, expiresAt: saved.expiresAt };
            }
            case 'authorization_pending':
            default:
                return { status: 'authorization_pending' };
        }
    }

    private async persistApproved(data: {
        sessionToken?: string;
        refreshToken?: string;
        expiresAt?: string;
        user?: Partial<AuthUser> | null;
    }): Promise<{ user: AuthUser; expiresAt: string } | null> {
        const sessionToken = String(data.sessionToken ?? '').trim();
        const refreshToken = String(data.refreshToken ?? '').trim();
        const user = normalizeUser(data.user ?? {});
        if (!sessionToken || !refreshToken || !user) return null;

        const expiresAtRaw = String(data.expiresAt ?? '').trim();
        const derivedExpMs = decodeJwtExpMs(sessionToken);
        const effectiveExpiresAt =
            expiresAtRaw && Number.isFinite(Date.parse(expiresAtRaw))
                ? new Date(expiresAtRaw).toISOString()
                : derivedExpMs
                    ? new Date(derivedExpMs).toISOString()
                    : null;
        if (!effectiveExpiresAt) return null;

        const updatedAt = this.now();
        await this.storage.writePersistent({ refreshToken, user, updatedAt });
        await this.storage.writeSession({
            sessionToken,
            expiresAt: effectiveExpiresAt,
            user,
            updatedAt,
        });
        return { user, expiresAt: effectiveExpiresAt };
    }

    /**
     * Run the full handshake: start, surface the code via `onCode`, then poll
     * until approval/expiry/denial. Respects the server `interval` and bumps it
     * on `slow_down`.
     */
    async enroll(onCode: (start: DeviceCodeStart) => void): Promise<DeviceCodePollResult> {
        const start = await this.start();
        onCode(start);

        const deadline = this.now() + start.expiresInSec * 1000;
        let intervalSec = start.intervalSec;

        while (this.now() < deadline) {
            await this.sleep(intervalSec * 1000);
            const result = await this.poll(start.deviceCode);
            if (result.status === 'approved') return result;
            if (result.status === 'denied' || result.status === 'expired') return result;
            if (result.status === 'slow_down') {
                intervalSec += SLOW_DOWN_BUMP_SEC;
            }
        }
        return { status: 'expired' };
    }
}
