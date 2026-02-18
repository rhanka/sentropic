import { getValidAccessToken } from './extension-auth';
import { loadExtensionConfig } from './extension-config';

export type ToolPermissionPolicy = 'allow' | 'deny';
export type ToolPermissionDecision =
    | 'allow_once'
    | 'deny_once'
    | 'allow_always'
    | 'deny_always';

export type ToolPermissionEntry = {
    toolName: string;
    origin: string;
    policy: ToolPermissionPolicy;
    updatedAt: string;
};

export type ToolPermissionRequest = {
    requestId: string;
    toolName: string;
    origin: string;
    tabId?: number;
    tabUrl?: string;
    tabTitle?: string;
    details?: Record<string, unknown>;
};

type PermissionCheckInput = {
    toolName: string;
    origin: string;
    tabId?: number;
    tabUrl?: string;
    tabTitle?: string;
    details?: Record<string, unknown>;
};

type PendingPermissionRequest = PermissionCheckInput & {
    requestId: string;
    createdAt: number;
};

type QueueOperation =
    | {
        type: 'upsert';
        entry: ToolPermissionEntry;
    }
    | {
        type: 'delete';
        toolName: string;
        origin: string;
    };

type RemoteListResponse = {
    items?: Array<{
        toolName?: string;
        origin?: string;
        policy?: string;
        updatedAt?: string;
    }>;
};

const STORAGE_KEY_POLICIES = 'topAiIdeas:toolPermissions:v1';
const STORAGE_KEY_QUEUE = 'topAiIdeas:toolPermissionsQueue:v1';
const SYNC_TTL_MS = 60_000;

const policiesByKey = new Map<string, ToolPermissionEntry>();
const pendingRequestsById = new Map<string, PendingPermissionRequest>();
const oneTimeAllowByKey = new Map<string, number>();
let offlineQueue: QueueOperation[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let lastSyncAt = 0;

const policyKey = (toolName: string, origin: string) => `${toolName}::${origin}`;

const normalizeOrigin = (raw: string): string | null => {
    const value = raw.trim();
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.origin;
    } catch {
        return null;
    }
};

const normalizePolicy = (value: string): ToolPermissionPolicy | null => {
    if (value === 'allow' || value === 'deny') return value;
    return null;
};

const normalizeEntry = (raw: {
    toolName?: string;
    origin?: string;
    policy?: string;
    updatedAt?: string;
}): ToolPermissionEntry | null => {
    const toolName = String(raw.toolName ?? '').trim();
    const origin = normalizeOrigin(String(raw.origin ?? ''));
    const policy = normalizePolicy(String(raw.policy ?? ''));
    const updatedAtRaw = String(raw.updatedAt ?? '').trim();
    const updatedAt =
        updatedAtRaw && Number.isFinite(Date.parse(updatedAtRaw))
            ? new Date(updatedAtRaw).toISOString()
            : new Date().toISOString();
    if (!toolName || !origin || !policy) return null;
    return {
        toolName,
        origin,
        policy,
        updatedAt,
    };
};

const parseStoredPolicies = (payload: unknown): ToolPermissionEntry[] => {
    if (!Array.isArray(payload)) return [];
    return payload
        .map((item) => normalizeEntry((item ?? {}) as Record<string, string>))
        .filter((item): item is ToolPermissionEntry => Boolean(item));
};

const parseStoredQueue = (payload: unknown): QueueOperation[] => {
    if (!Array.isArray(payload)) return [];
    const parsed: QueueOperation[] = [];
    for (const item of payload) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as any;
        if (raw.type === 'upsert') {
            const entry = normalizeEntry(raw.entry ?? {});
            if (!entry) continue;
            parsed.push({ type: 'upsert', entry });
            continue;
        }
        if (raw.type === 'delete') {
            const toolName = String(raw.toolName ?? '').trim();
            const origin = normalizeOrigin(String(raw.origin ?? ''));
            if (!toolName || !origin) continue;
            parsed.push({ type: 'delete', toolName, origin });
        }
    }
    return parsed;
};

const persistPolicies = async () => {
    const items = Array.from(policiesByKey.values()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
    );
    await chrome.storage.local.set({
        [STORAGE_KEY_POLICIES]: items,
    });
};

const persistQueue = async () => {
    await chrome.storage.local.set({
        [STORAGE_KEY_QUEUE]: offlineQueue,
    });
};

const ensureLoaded = async () => {
    if (loaded) return;
    if (loadPromise) {
        await loadPromise;
        return;
    }
    loadPromise = (async () => {
        const payload = await chrome.storage.local.get([
            STORAGE_KEY_POLICIES,
            STORAGE_KEY_QUEUE,
        ]);
        const storedPolicies = parseStoredPolicies(payload?.[STORAGE_KEY_POLICIES]);
        policiesByKey.clear();
        for (const entry of storedPolicies) {
            policiesByKey.set(policyKey(entry.toolName, entry.origin), entry);
        }
        offlineQueue = parseStoredQueue(payload?.[STORAGE_KEY_QUEUE]);
        loaded = true;
    })();
    await loadPromise;
    loadPromise = null;
};

const queueOperation = async (operation: QueueOperation) => {
    const opKey =
        operation.type === 'upsert'
            ? policyKey(operation.entry.toolName, operation.entry.origin)
            : policyKey(operation.toolName, operation.origin);
    offlineQueue = offlineQueue.filter((existing) => {
        const existingKey =
            existing.type === 'upsert'
                ? policyKey(existing.entry.toolName, existing.entry.origin)
                : policyKey(existing.toolName, existing.origin);
        return existingKey !== opKey;
    });
    offlineQueue.push(operation);
    await persistQueue();
};

const fetchRemotePolicies = async (): Promise<ToolPermissionEntry[] | null> => {
    const config = await loadExtensionConfig();
    const token = await getValidAccessToken(config, { allowRefresh: true });
    if (!token) return null;

    const response = await fetch(`${config.apiBaseUrl}/chat/tool-permissions`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`Unable to fetch tool permissions (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as RemoteListResponse;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items
        .map((item) => normalizeEntry(item ?? {}))
        .filter((item): item is ToolPermissionEntry => Boolean(item));
};

const pushUpsert = async (entry: ToolPermissionEntry): Promise<void> => {
    const config = await loadExtensionConfig();
    const token = await getValidAccessToken(config, { allowRefresh: true });
    if (!token) {
        throw new Error('Extension is not authenticated.');
    }
    const response = await fetch(`${config.apiBaseUrl}/chat/tool-permissions`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            toolName: entry.toolName,
            origin: entry.origin,
            policy: entry.policy,
        }),
    });
    if (!response.ok) {
        throw new Error(`Unable to upsert tool permission (HTTP ${response.status})`);
    }
};

const pushDelete = async (toolName: string, origin: string): Promise<void> => {
    const config = await loadExtensionConfig();
    const token = await getValidAccessToken(config, { allowRefresh: true });
    if (!token) {
        throw new Error('Extension is not authenticated.');
    }
    const response = await fetch(`${config.apiBaseUrl}/chat/tool-permissions`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            toolName,
            origin,
        }),
    });
    if (!response.ok) {
        throw new Error(`Unable to delete tool permission (HTTP ${response.status})`);
    }
};

const flushOfflineQueue = async (): Promise<void> => {
    await ensureLoaded();
    if (offlineQueue.length === 0) return;
    const remaining: QueueOperation[] = [];
    for (const operation of offlineQueue) {
        try {
            if (operation.type === 'upsert') {
                await pushUpsert(operation.entry);
            } else {
                await pushDelete(operation.toolName, operation.origin);
            }
        } catch {
            remaining.push(operation);
        }
    }
    offlineQueue = remaining;
    await persistQueue();
};

const reconcileWithRemote = async (remoteEntries: ToolPermissionEntry[]) => {
    const remoteByKey = new Map<string, ToolPermissionEntry>();
    for (const entry of remoteEntries) {
        remoteByKey.set(policyKey(entry.toolName, entry.origin), entry);
    }

    for (const [key, remote] of remoteByKey.entries()) {
        const local = policiesByKey.get(key);
        if (!local) {
            policiesByKey.set(key, remote);
            continue;
        }
        const localUpdatedAt = Date.parse(local.updatedAt);
        const remoteUpdatedAt = Date.parse(remote.updatedAt);
        if (Number.isFinite(remoteUpdatedAt) && remoteUpdatedAt > localUpdatedAt) {
            policiesByKey.set(key, remote);
            continue;
        }
        if (Number.isFinite(localUpdatedAt) && localUpdatedAt > remoteUpdatedAt) {
            await queueOperation({
                type: 'upsert',
                entry: local,
            });
        }
    }

    await persistPolicies();
};

const syncWithBackendIfNeeded = async (force = false): Promise<void> => {
    await ensureLoaded();
    const now = Date.now();
    if (!force && now - lastSyncAt < SYNC_TTL_MS) return;
    try {
        const remote = await fetchRemotePolicies();
        if (remote) {
            await reconcileWithRemote(remote);
        }
        await flushOfflineQueue();
        lastSyncAt = now;
    } catch {
        // Silent fallback to local cache.
    }
};

export async function evaluateToolPermission(
    input: PermissionCheckInput,
): Promise<
    | { allowed: true }
    | { allowed: false; denied: true; reason: string }
    | { allowed: false; request: ToolPermissionRequest }
> {
    await ensureLoaded();
    await syncWithBackendIfNeeded(false);

    const key = policyKey(input.toolName, input.origin);
    const persisted = policiesByKey.get(key);
    if (persisted?.policy === 'allow') {
        return { allowed: true };
    }
    if (persisted?.policy === 'deny') {
        return {
            allowed: false,
            denied: true,
            reason: `Permission denied for ${input.toolName} on ${input.origin}.`,
        };
    }

    const oneTimeLeft = oneTimeAllowByKey.get(key) ?? 0;
    if (oneTimeLeft > 0) {
        if (oneTimeLeft === 1) {
            oneTimeAllowByKey.delete(key);
        } else {
            oneTimeAllowByKey.set(key, oneTimeLeft - 1);
        }
        return { allowed: true };
    }

    const requestId = crypto.randomUUID();
    pendingRequestsById.set(requestId, {
        ...input,
        requestId,
        createdAt: Date.now(),
    });
    return {
        allowed: false,
        request: {
            requestId,
            toolName: input.toolName,
            origin: input.origin,
            tabId: input.tabId,
            tabUrl: input.tabUrl,
            tabTitle: input.tabTitle,
            details: input.details,
        },
    };
}

export async function applyToolPermissionDecision(input: {
    requestId: string;
    decision: ToolPermissionDecision;
}): Promise<void> {
    await ensureLoaded();
    const pending = pendingRequestsById.get(input.requestId);
    if (!pending) {
        throw new Error('Unknown tool permission request.');
    }
    pendingRequestsById.delete(input.requestId);
    const key = policyKey(pending.toolName, pending.origin);

    if (input.decision === 'allow_once') {
        const previous = oneTimeAllowByKey.get(key) ?? 0;
        oneTimeAllowByKey.set(key, previous + 1);
        return;
    }

    if (input.decision === 'deny_once') {
        return;
    }

    const entry: ToolPermissionEntry = {
        toolName: pending.toolName,
        origin: pending.origin,
        policy: input.decision === 'allow_always' ? 'allow' : 'deny',
        updatedAt: new Date().toISOString(),
    };
    policiesByKey.set(key, entry);
    await persistPolicies();
    await queueOperation({
        type: 'upsert',
        entry,
    });
    await flushOfflineQueue();
}

export async function listToolPermissionPolicies(): Promise<ToolPermissionEntry[]> {
    await ensureLoaded();
    await syncWithBackendIfNeeded(true);
    return Array.from(policiesByKey.values()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export async function upsertToolPermissionPolicy(input: {
    toolName: string;
    origin: string;
    policy: ToolPermissionPolicy;
}): Promise<ToolPermissionEntry> {
    await ensureLoaded();
    const toolName = String(input.toolName ?? '').trim();
    const origin = normalizeOrigin(String(input.origin ?? ''));
    if (!toolName || !origin) {
        throw new Error('Invalid tool permission payload.');
    }
    const policy = normalizePolicy(String(input.policy ?? ''));
    if (!policy) {
        throw new Error('Invalid policy value.');
    }
    const entry: ToolPermissionEntry = {
        toolName,
        origin,
        policy,
        updatedAt: new Date().toISOString(),
    };
    policiesByKey.set(policyKey(toolName, origin), entry);
    await persistPolicies();
    await queueOperation({
        type: 'upsert',
        entry,
    });
    await flushOfflineQueue();
    return entry;
}

export async function deleteToolPermissionPolicy(input: {
    toolName: string;
    origin: string;
}): Promise<void> {
    await ensureLoaded();
    const toolName = String(input.toolName ?? '').trim();
    const origin = normalizeOrigin(String(input.origin ?? ''));
    if (!toolName || !origin) {
        throw new Error('Invalid tool permission payload.');
    }
    policiesByKey.delete(policyKey(toolName, origin));
    await persistPolicies();
    await queueOperation({
        type: 'delete',
        toolName,
        origin,
    });
    await flushOfflineQueue();
}

export async function bootstrapToolPermissionSync(): Promise<void> {
    await ensureLoaded();
    await syncWithBackendIfNeeded(true);
}

export const normalizePermissionOrigin = normalizeOrigin;
