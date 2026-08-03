import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verify, createPublicKey } from 'node:crypto';
import { createFileStore, type FileStore } from '../src/storage/index.js';
import { loadOrCreateDeviceIdentity } from '../src/enroll/index.js';
import { DESKTOP_ORIGIN } from '../src/consent/index.js';

describe('createFileStore — StorageAdapter + ConsentStore round-trip', () => {
    let dir: string;
    let store: FileStore;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'cowork-store-'));
        store = createFileStore(dir);
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('persists and reloads persistent auth state across instances', async () => {
        const state = {
            refreshToken: 'r-1',
            user: { id: 'u1', role: 'editor' as const, email: null, displayName: null },
            updatedAt: 123,
        };
        await store.writePersistent(state);
        // A fresh instance reads from disk.
        const reopened = createFileStore(dir);
        expect(await reopened.readPersistent()).toEqual(state);
    });

    it('keeps session (access-token) state in memory only — not on disk', async () => {
        await store.writeSession({
            sessionToken: 's-1',
            expiresAt: new Date().toISOString(),
            user: { id: 'u1', role: 'editor', email: null, displayName: null },
            updatedAt: 1,
        });
        expect(await store.readSession()).not.toBeNull();
        // A fresh instance pointed at the same dir must NOT see the session token.
        const reopened = createFileStore(dir);
        expect(await reopened.readSession()).toBeNull();
    });

    it('clears persistent state', async () => {
        await store.writePersistent({
            refreshToken: 'r',
            user: { id: 'u', role: 'guest', email: null, displayName: null },
            updatedAt: 0,
        });
        await store.clearPersistent();
        expect(await store.readPersistent()).toBeNull();
    });

    it('persists one Ed25519 device identity across store instances', async () => {
        const first = await loadOrCreateDeviceIdentity(store);
        const reopened = await loadOrCreateDeviceIdentity(createFileStore(dir));
        expect(reopened.deviceId).toBe(first.deviceId);
        expect(reopened.publicKey).toBe(first.publicKey);
        const payload = 'cowork-enroll-v1:device.nonce';
        const publicKey = createPublicKey({
            key: Buffer.from(first.publicKey, 'base64url'), format: 'der', type: 'spki',
        });
        expect(verify(null, Buffer.from(payload), publicKey, Buffer.from(await reopened.sign(payload), 'base64url'))).toBe(true);
    });

    it('persists, lists, and clears consent entries on disk', async () => {
        await store.upsertEntry({
            toolName: 'screen_capture',
            origin: DESKTOP_ORIGIN,
            policy: 'allow',
            updatedAt: new Date().toISOString(),
        });
        const reopened = createFileStore(dir);
        const entries = await reopened.readEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ toolName: 'screen_capture', policy: 'allow' });

        await reopened.clear();
        expect(await createFileStore(dir).readEntries()).toHaveLength(0);
    });

    it('removes a single consent entry', async () => {
        await store.upsertEntry({
            toolName: 'input_action',
            origin: DESKTOP_ORIGIN,
            policy: 'deny',
            updatedAt: new Date().toISOString(),
        });
        await store.removeEntry('input_action', DESKTOP_ORIGIN);
        expect(await store.readEntries()).toHaveLength(0);
    });
});
