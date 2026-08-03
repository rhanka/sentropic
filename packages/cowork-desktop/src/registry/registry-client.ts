import type { FetchLike } from '@sentropic/cowork-bridge/auth';

/**
 * Presence registry client. After enrollment the binary registers itself in the
 * Sentropic presence registry as a non-browser device (`source:"desktop_cowork"`)
 * so the chat can target the workstation. It keeps the entry alive with a 15s
 * keepalive and unregisters on quit (SPEC §6, mirrors the Chrome plugin).
 */

const KEEPALIVE_INTERVAL_MS = 15_000;
const DESKTOP_SOURCE = 'desktop_cowork';

export interface RegistryClientDeps {
    fetch: FetchLike;
    /** API base URL, e.g. `https://api.example.com/api/v1`. */
    apiBaseUrl: string;
    /** Returns a valid bearer access token (e.g. `SessionAuthClient.getValidAccessToken`). */
    getAccessToken: () => Promise<string | null>;
    /** Device display name shown in the chat target selector. */
    deviceName?: string;
    /** Stable, PoP-enrolled Cowork device id. */
    deviceId: string;
    /** Keepalive interval (ms). Defaults to 15s. */
    keepaliveIntervalMs?: number;
    /** Injected interval scheduler (for tests). Defaults to `setInterval`. */
    setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    /** Injected interval clearer (for tests). Defaults to `clearInterval`. */
    clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export class RegistryClient {
    private readonly fetch: FetchLike;
    private readonly apiBaseUrl: string;
    private readonly getAccessToken: () => Promise<string | null>;
    private readonly deviceName: string;
    private readonly deviceId: string;
    private readonly keepaliveIntervalMs: number;
    private readonly setIntervalFn: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    private readonly clearIntervalFn: (handle: ReturnType<typeof setInterval>) => void;

    private tabId: string | null = null;
    private keepaliveHandle: ReturnType<typeof setInterval> | null = null;

    constructor(deps: RegistryClientDeps) {
        this.fetch = deps.fetch;
        this.apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
        this.getAccessToken = deps.getAccessToken;
        this.deviceName = deps.deviceName ?? 'Sentropic Cowork';
        this.deviceId = deps.deviceId;
        this.keepaliveIntervalMs = deps.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS;
        this.setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
        this.clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h));
    }

    /** The registry id assigned on registration (`device_<uuid>`), or null. */
    get registeredTabId(): string | null {
        return this.tabId;
    }

    private async authHeaders(): Promise<Record<string, string>> {
        const token = await this.getAccessToken();
        if (!token) throw new Error('registry: no valid access token available');
        return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    /** Register the device and start the keepalive loop. Idempotent. */
    async register(): Promise<string> {
        if (this.tabId) return this.tabId;
        const response = await this.fetch(`${this.apiBaseUrl}/chrome-extension/tabs/register`, {
            method: 'POST',
            headers: await this.authHeaders(),
            body: JSON.stringify({
                source: DESKTOP_SOURCE,
                device_id: this.deviceId,
                url: 'desktop://cowork',
                title: this.deviceName,
            }),
        });
        if (!response.ok) {
            throw new Error(`registry register failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as { ok?: boolean; tab_id?: string; device_id?: string };
        const registeredDeviceId = data.device_id ?? data.tab_id;
        if (!data.ok || registeredDeviceId !== this.deviceId) {
            throw new Error('registry register returned an invalid payload');
        }
        this.tabId = registeredDeviceId;
        this.startKeepalive();
        return this.tabId;
    }

    private startKeepalive(): void {
        if (this.keepaliveHandle) return;
        this.keepaliveHandle = this.setIntervalFn(() => {
            void this.keepalive();
        }, this.keepaliveIntervalMs);
    }

    /** Send a single keepalive ping. No-op when not registered. */
    async keepalive(): Promise<void> {
        if (!this.tabId) return;
        await this.fetch(`${this.apiBaseUrl}/chrome-extension/tabs/keepalive`, {
            method: 'POST',
            headers: await this.authHeaders(),
            body: JSON.stringify({ device_id: this.tabId }),
        }).catch(() => {
            // Keepalive is best-effort; eviction will re-register on next launch.
        });
    }

    /** Stop the keepalive loop and unregister the device. Safe to call on quit. */
    async unregister(): Promise<void> {
        if (this.keepaliveHandle) {
            this.clearIntervalFn(this.keepaliveHandle);
            this.keepaliveHandle = null;
        }
        const tabId = this.tabId;
        this.tabId = null;
        if (!tabId) return;
        await this.fetch(`${this.apiBaseUrl}/chrome-extension/tabs/${encodeURIComponent(tabId)}`, {
            method: 'DELETE',
            headers: await this.authHeaders(),
        }).catch(() => {
            // Best-effort; the server evicts stale entries after 45s anyway.
        });
    }
}
