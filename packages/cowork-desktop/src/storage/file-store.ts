import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
    AuthPersistentState,
    AuthSessionState,
    StorageAdapter,
} from '@sentropic/cowork-bridge/auth';
import {
    normalizeEntry,
    policyKey,
    type ToolPermissionEntry,
} from '@sentropic/cowork-bridge/permissions';
import type { ConsentStore } from '../consent/index.js';

/**
 * Node file-backed implementation of the bridge {@link StorageAdapter} and the
 * desktop {@link ConsentStore}, under a per-user app directory.
 *
 * - Persistent auth state (refresh token + user) survives restarts on disk.
 * - Session auth state (access token) is kept in memory only — it is short-lived
 *   and re-derived from the refresh token, so it never touches the zip directory
 *   (see SPEC §11 security model).
 * - Consent policies (`allow_always` / `deny_always`) are persisted on disk.
 *
 * On Windows the real binary should prefer the OS credential manager for the
 * refresh token; this file store is the portable fallback and the test seam.
 */

const PERSISTENT_FILE = 'auth.json';
const CONSENT_FILE = 'consent.json';

type ConsentFileShape = { entries: ToolPermissionEntry[] };

const readJson = async <T>(path: string): Promise<T | null> => {
    try {
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    // 0o600: owner read/write only — never world-readable on disk.
    await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
};

export interface FileStore extends StorageAdapter, ConsentStore {}

/**
 * Create a file-backed store rooted at `appDir`. The session (access-token)
 * state stays in process memory; everything else is persisted under `appDir`.
 */
export const createFileStore = (appDir: string): FileStore => {
    const persistentPath = join(appDir, PERSISTENT_FILE);
    const consentPath = join(appDir, CONSENT_FILE);
    let sessionState: AuthSessionState | null = null;

    const readConsentEntries = async (): Promise<Map<string, ToolPermissionEntry>> => {
        const file = await readJson<ConsentFileShape>(consentPath);
        const map = new Map<string, ToolPermissionEntry>();
        for (const raw of file?.entries ?? []) {
            const entry = normalizeEntry(raw);
            if (entry) map.set(policyKey(entry.toolName, entry.origin), entry);
        }
        return map;
    };

    const writeConsentEntries = async (
        map: Map<string, ToolPermissionEntry>,
    ): Promise<void> => {
        await writeJson(consentPath, { entries: Array.from(map.values()) } satisfies ConsentFileShape);
    };

    return {
        // --- StorageAdapter (auth) ---
        async readPersistent(): Promise<AuthPersistentState | null> {
            return readJson<AuthPersistentState>(persistentPath);
        },
        async writePersistent(state: AuthPersistentState): Promise<void> {
            await writeJson(persistentPath, state);
        },
        async clearPersistent(): Promise<void> {
            await rm(persistentPath, { force: true });
        },
        async readSession(): Promise<AuthSessionState | null> {
            return sessionState;
        },
        async writeSession(state: AuthSessionState): Promise<void> {
            sessionState = state;
        },
        async clearSession(): Promise<void> {
            sessionState = null;
        },

        // --- ConsentStore ---
        async readEntries(): Promise<ToolPermissionEntry[]> {
            return Array.from((await readConsentEntries()).values());
        },
        async upsertEntry(raw: ToolPermissionEntry): Promise<void> {
            const entry = normalizeEntry(raw);
            if (!entry) return;
            const map = await readConsentEntries();
            map.set(policyKey(entry.toolName, entry.origin), entry);
            await writeConsentEntries(map);
        },
        async removeEntry(toolName: string, origin: string): Promise<void> {
            const normalized = normalizeEntry({
                toolName,
                origin,
                policy: 'deny',
                updatedAt: new Date().toISOString(),
            });
            if (!normalized) return;
            const map = await readConsentEntries();
            if (map.delete(policyKey(normalized.toolName, normalized.origin))) {
                await writeConsentEntries(map);
            }
        },
        async clear(): Promise<void> {
            await rm(consentPath, { force: true });
        },
    };
};
