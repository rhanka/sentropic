import {
    normalizeEntry,
    policyKey,
    type ToolPermissionEntry,
} from '@sentropic/cowork-bridge/permissions';
import type { ConsentStore } from './types.js';

/**
 * In-memory {@link ConsentStore}. Used by tests and as the session-scoped
 * fallback when no durable store is configured. Entries are normalized through
 * the bridge `normalizeEntry` so invalid policies are rejected on write.
 */
export const createMemoryConsentStore = (
    seed?: ToolPermissionEntry[],
): ConsentStore => {
    const entries = new Map<string, ToolPermissionEntry>();
    for (const raw of seed ?? []) {
        const entry = normalizeEntry(raw);
        if (entry) entries.set(policyKey(entry.toolName, entry.origin), entry);
    }

    return {
        async readEntries(): Promise<ToolPermissionEntry[]> {
            return Array.from(entries.values());
        },
        async upsertEntry(raw: ToolPermissionEntry): Promise<void> {
            const entry = normalizeEntry(raw);
            if (!entry) return;
            entries.set(policyKey(entry.toolName, entry.origin), entry);
        },
        async removeEntry(toolName: string, origin: string): Promise<void> {
            const normalized = normalizeEntry({
                toolName,
                origin,
                policy: 'deny',
                updatedAt: new Date().toISOString(),
            });
            if (!normalized) return;
            entries.delete(policyKey(normalized.toolName, normalized.origin));
        },
        async clear(): Promise<void> {
            entries.clear();
        },
    };
};
