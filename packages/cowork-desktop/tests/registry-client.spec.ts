import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@sentropic/cowork-bridge/auth';
import { RegistryClient } from '../src/registry/index.js';

const jsonResponse = (body: unknown, status = 200): ReturnType<FetchLike> =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const makeClient = (fetchFn: ReturnType<typeof vi.fn<FetchLike>>) => {
    const intervalFns: Array<() => void> = [];
    const client = new RegistryClient({
        fetch: fetchFn,
        apiBaseUrl: 'https://api/api/v1',
        getAccessToken: async () => 'token-abc',
        deviceName: 'Lab PC',
        setIntervalFn: (fn) => {
            intervalFns.push(fn);
            return 0 as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: () => {},
    });
    return { client, intervalFns };
};

describe('RegistryClient', () => {
    it('registers as desktop_cowork with a bearer token and stores the device id', async () => {
        const fetchFn = vi.fn<FetchLike>().mockReturnValue(jsonResponse({ ok: true, tab_id: 'device_42' }));
        const { client } = makeClient(fetchFn);

        const id = await client.register();
        expect(id).toBe('device_42');
        expect(client.registeredTabId).toBe('device_42');

        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('https://api/api/v1/chrome-extension/tabs/register');
        expect(init?.headers?.Authorization).toBe('Bearer token-abc');
        expect(JSON.parse(init?.body ?? '{}')).toMatchObject({ source: 'desktop_cowork', title: 'Lab PC' });
    });

    it('is idempotent — a second register does not re-POST', async () => {
        const fetchFn = vi.fn<FetchLike>().mockReturnValue(jsonResponse({ ok: true, tab_id: 'device_1' }));
        const { client } = makeClient(fetchFn);
        await client.register();
        await client.register();
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('keepalive pings the registered device id', async () => {
        const fetchFn = vi.fn<FetchLike>().mockReturnValue(jsonResponse({ ok: true, tab_id: 'device_7' }));
        const { client } = makeClient(fetchFn);
        await client.register();
        fetchFn.mockClear();
        fetchFn.mockReturnValue(jsonResponse({ ok: true, evicted_count: 0 }));

        await client.keepalive();
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api/api/v1/chrome-extension/tabs/keepalive',
            expect.objectContaining({ body: JSON.stringify({ tab_id: 'device_7' }) }),
        );
    });

    it('unregister DELETEs the device id and clears local state', async () => {
        const fetchFn = vi.fn<FetchLike>().mockReturnValue(jsonResponse({ ok: true, tab_id: 'device_9' }));
        const { client } = makeClient(fetchFn);
        await client.register();
        fetchFn.mockClear();
        fetchFn.mockReturnValue(jsonResponse({ ok: true }));

        await client.unregister();
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api/api/v1/chrome-extension/tabs/device_9',
            expect.objectContaining({ method: 'DELETE' }),
        );
        expect(client.registeredTabId).toBeNull();
    });

    it('keepalive is a no-op before registration', async () => {
        const fetchFn = vi.fn<FetchLike>();
        const { client } = makeClient(fetchFn);
        await client.keepalive();
        expect(fetchFn).not.toHaveBeenCalled();
    });
});
