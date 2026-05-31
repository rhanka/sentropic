import { describe, expect, it, vi } from 'vitest';
import {
    SessionAuthClient,
    type FetchLike,
    type StorageAdapter,
    type AuthPersistentState,
    type AuthSessionState,
} from '../src/auth/index.js';

/** In-memory StorageAdapter for exercising the auth lifecycle seam. */
const createFakeStorage = (seed?: {
    persistent?: AuthPersistentState | null;
    session?: AuthSessionState | null;
}): StorageAdapter & {
    persistent: AuthPersistentState | null;
    session: AuthSessionState | null;
} => {
    const state = {
        persistent: seed?.persistent ?? null,
        session: seed?.session ?? null,
    };
    return {
        get persistent() {
            return state.persistent;
        },
        get session() {
            return state.session;
        },
        async readPersistent() {
            return state.persistent;
        },
        async writePersistent(value) {
            state.persistent = value;
        },
        async clearPersistent() {
            state.persistent = null;
        },
        async readSession() {
            return state.session;
        },
        async writeSession(value) {
            state.session = value;
        },
        async clearSession() {
            state.session = null;
        },
    };
};

const okJson = (body: unknown, status = 200): ReturnType<FetchLike> =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const config = { apiBaseUrl: 'https://api.test/api/v1', appBaseUrl: 'https://app.test' };
const farFuture = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('SessionAuthClient — StorageAdapter seam', () => {
    it('returns the cached token without refreshing when it is not expiring', async () => {
        const storage = createFakeStorage({
            session: {
                sessionToken: 'cached-token',
                expiresAt: farFuture(),
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
        });
        const fetchFn = vi.fn<FetchLike>();
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        expect(await client.getValidAccessToken()).toBe('cached-token');
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('refreshes via the stored refresh token when the session is expiring', async () => {
        const storage = createFakeStorage({
            persistent: {
                refreshToken: 'r1',
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
            session: {
                sessionToken: 'stale',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
        });
        const fetchFn = vi.fn<FetchLike>((url, init) => {
            if (url.endsWith('/auth/session/refresh') && init?.method === 'POST') {
                return okJson({
                    sessionToken: 'fresh-token',
                    refreshToken: 'r1',
                    expiresAt: farFuture(),
                    user: { id: 'u1', role: 'editor' },
                });
            }
            if (url.endsWith('/auth/session') && init?.method === 'GET') {
                return okJson({ userId: 'u1', role: 'editor' });
            }
            throw new Error(`unexpected fetch ${url}`);
        });
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        expect(await client.getValidAccessToken()).toBe('fresh-token');
        expect(storage.session?.sessionToken).toBe('fresh-token');
    });

    it('clears all state when refresh fails', async () => {
        const storage = createFakeStorage({
            persistent: {
                refreshToken: 'r1',
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
            session: {
                sessionToken: 'stale',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
        });
        const fetchFn = vi.fn<FetchLike>(() => okJson({ error: 'invalid' }, 401));
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        expect(await client.getValidAccessToken()).toBeNull();
        expect(storage.persistent).toBeNull();
        expect(storage.session).toBeNull();
    });

    it('does not refresh when allowRefresh is false', async () => {
        const storage = createFakeStorage({
            persistent: {
                refreshToken: 'r1',
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
            session: {
                sessionToken: 'stale',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
        });
        const fetchFn = vi.fn<FetchLike>();
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        expect(await client.getValidAccessToken({ allowRefresh: false })).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('connect() persists issued tokens on success', async () => {
        const storage = createFakeStorage();
        const fetchFn = vi.fn<FetchLike>((url) => {
            if (url.endsWith('/auth/session/extension-token')) {
                return okJson({
                    sessionToken: 'sess',
                    refreshToken: 'refr',
                    expiresAt: farFuture(),
                    user: { id: 'u9', role: 'admin_app' },
                });
            }
            throw new Error(`unexpected fetch ${url}`);
        });
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        const result = await client.connect();
        expect(result.ok).toBe(true);
        expect(storage.persistent?.refreshToken).toBe('refr');
        expect(storage.session?.sessionToken).toBe('sess');
    });

    it('connect() surfaces APP_SESSION_REQUIRED on 401 with a login URL', async () => {
        const storage = createFakeStorage();
        const fetchFn = vi.fn<FetchLike>(() => okJson({}, 401));
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        const result = await client.connect();
        expect(result).toMatchObject({
            ok: false,
            code: 'APP_SESSION_REQUIRED',
            loginUrl: 'https://app.test/auth/login',
        });
    });

    it('logout() revokes then clears local state', async () => {
        const storage = createFakeStorage({
            session: {
                sessionToken: 'cached',
                expiresAt: farFuture(),
                user: { id: 'u1', role: 'editor', email: null, displayName: null },
                updatedAt: Date.now(),
            },
        });
        const calls: string[] = [];
        const fetchFn = vi.fn<FetchLike>((url, init) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            return okJson({ ok: true });
        });
        const client = new SessionAuthClient({ storage, fetch: fetchFn, config });

        await client.logout();
        expect(calls).toContain('DELETE https://api.test/api/v1/auth/session');
        expect(storage.session).toBeNull();
        expect(storage.persistent).toBeNull();
    });
});
