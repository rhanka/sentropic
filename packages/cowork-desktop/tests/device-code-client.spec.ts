import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, StorageAdapter } from '@sentropic/cowork-bridge/auth';
import { DeviceCodeClient } from '../src/enroll/index.js';

const base64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (expSeconds: number): string =>
    `${base64url({ alg: 'HS256' })}.${base64url({ exp: expSeconds })}.sig`;

const memoryStorage = (): StorageAdapter & { persistent: unknown; session: unknown } => {
    const state = { persistent: null as unknown, session: null as unknown };
    return {
        get persistent() {
            return state.persistent;
        },
        get session() {
            return state.session;
        },
        async readPersistent() {
            return state.persistent as never;
        },
        async writePersistent(v) {
            state.persistent = v;
        },
        async clearPersistent() {
            state.persistent = null;
        },
        async readSession() {
            return state.session as never;
        },
        async writeSession(v) {
            state.session = v;
        },
        async clearSession() {
            state.session = null;
        },
    };
};

const jsonResponse = (body: unknown, status = 200): ReturnType<FetchLike> =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('DeviceCodeClient — start', () => {
    it('requests a code and normalizes the payload', async () => {
        const fetchFn = vi.fn<FetchLike>().mockReturnValue(
            jsonResponse({
                device_code: 'dev-123',
                user_code: 'PAIR-ABCD',
                verification_uri: 'https://app/auth/devices/pair',
                interval: 5,
                expires_in: 600,
            }),
        );
        const client = new DeviceCodeClient({
            fetch: fetchFn,
            storage: memoryStorage(),
            apiBaseUrl: 'https://api/api/v1',
            deviceName: 'Lab PC',
        });
        const start = await client.start();
        expect(start).toMatchObject({ deviceCode: 'dev-123', userCode: 'PAIR-ABCD', intervalSec: 5 });
        expect(fetchFn).toHaveBeenCalledWith(
            'https://api/api/v1/auth/device/code',
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ deviceName: 'Lab PC' }) }),
        );
    });
});

describe('DeviceCodeClient — poll state machine', () => {
    it('maps pending / slow_down / denied statuses', async () => {
        const client = new DeviceCodeClient({
            fetch: vi
                .fn<FetchLike>()
                .mockReturnValueOnce(jsonResponse({ status: 'authorization_pending' }))
                .mockReturnValueOnce(jsonResponse({ status: 'slow_down' }))
                .mockReturnValueOnce(jsonResponse({ status: 'denied' })),
            storage: memoryStorage(),
            apiBaseUrl: 'https://api/api/v1',
        });
        expect(await client.poll('d')).toEqual({ status: 'authorization_pending' });
        expect(await client.poll('d')).toEqual({ status: 'slow_down' });
        expect(await client.poll('d')).toEqual({ status: 'denied' });
    });

    it('stores the token pair on approval and returns the user', async () => {
        const storage = memoryStorage();
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const client = new DeviceCodeClient({
            fetch: vi.fn<FetchLike>().mockReturnValue(
                jsonResponse({
                    status: 'approved',
                    sessionToken: makeJwt(exp),
                    refreshToken: 'refresh-xyz',
                    expiresAt: new Date(exp * 1000).toISOString(),
                    user: { id: 'u1', role: 'editor', email: 'a@b.c', displayName: 'A' },
                }),
            ),
            storage,
            apiBaseUrl: 'https://api/api/v1',
        });
        const result = await client.poll('d');
        expect(result.status).toBe('approved');
        if (result.status === 'approved') {
            expect(result.user).toMatchObject({ id: 'u1', role: 'editor' });
        }
        expect((storage.persistent as { refreshToken: string }).refreshToken).toBe('refresh-xyz');
        expect((storage.session as { sessionToken: string }).sessionToken).toBeTruthy();
    });

    it('rejects an approval with a missing refresh token', async () => {
        const client = new DeviceCodeClient({
            fetch: vi.fn<FetchLike>().mockReturnValue(
                jsonResponse({ status: 'approved', sessionToken: 'x', user: { id: 'u1', role: 'editor' } }),
            ),
            storage: memoryStorage(),
            apiBaseUrl: 'https://api/api/v1',
        });
        await expect(client.poll('d')).rejects.toThrow(/invalid token payload/);
    });
});

describe('DeviceCodeClient — enroll loop', () => {
    it('drives pending → slow_down → approved, respecting the injected sleep/clock', async () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        let clock = 0;
        const fetchFn = vi
            .fn<FetchLike>()
            // start
            .mockReturnValueOnce(
                jsonResponse({ device_code: 'd1', user_code: 'PAIR-ZZZZ', interval: 5, expires_in: 600 }),
            )
            // poll #1 pending, #2 slow_down, #3 approved
            .mockReturnValueOnce(jsonResponse({ status: 'authorization_pending' }))
            .mockReturnValueOnce(jsonResponse({ status: 'slow_down' }))
            .mockReturnValueOnce(
                jsonResponse({
                    status: 'approved',
                    sessionToken: makeJwt(exp),
                    refreshToken: 'r',
                    user: { id: 'u1', role: 'editor' },
                }),
            );
        const sleep = vi.fn(async (ms: number) => {
            clock += ms;
        });
        const onCode = vi.fn();
        const client = new DeviceCodeClient({
            fetch: fetchFn,
            storage: memoryStorage(),
            apiBaseUrl: 'https://api/api/v1',
            sleep,
            now: () => clock,
        });

        const outcome = await client.enroll(onCode);
        expect(outcome.status).toBe('approved');
        expect(onCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'PAIR-ZZZZ' }));
        // interval starts at 5s, bumps to 10s after the slow_down → 5 + 5 + 10 = 20s slept.
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 5000, 10000]);
    });
});
