/**
 * agentsViewMarkers.ts — per-principal "last consultation" markers (D6a).
 *
 * R9 orders resting entries by the age of their LAST CONSULTATION, which is
 * per-`(principal, entry)` state and is NOT `updatedAt`. Nothing stores it today.
 *
 * Built over the storage adapter that ALREADY exists (`ChatUiStorageAdapter`)
 * rather than a new port, and **async-tolerant** because its methods may return
 * promises — the Chrome host backs them with `chrome.storage`, so a synchronous
 * API could not be implemented there.
 *
 * Markers are namespaced by principal + workspace: two principals on one browser
 * must not inherit each other's read state.
 */

import type { ChatUiStorageAdapter } from '../hosts/createWebHost.js';
import type { AgentsEntry } from './agentsEntry.js';

export type AgentsViewMarkersConfig = {
  readonly storage?: ChatUiStorageAdapter;
  readonly principalId?: string;
  readonly workspaceId?: string;
  /** Cap on retained markers; the oldest are dropped. Keeps storage bounded. */
  readonly maxEntries?: number;
};

export type AgentsViewMarkers = {
  read: () => Promise<Record<string, number>>;
  markViewed: (entryId: string, at: number) => Promise<void>;
  /** Merge stored markers into entries, keeping the most recent of the two. */
  apply: (entries: readonly AgentsEntry[]) => Promise<AgentsEntry[]>;
};

const DEFAULT_MAX_ENTRIES = 500;

export const buildAgentsViewMarkersKey = (config: AgentsViewMarkersConfig): string =>
  `chat-ui:agents:view-markers:${config.principalId ?? 'anon'}:${config.workspaceId ?? 'all'}`;

/** Drop anything that is not a finite positive epoch — a corrupt store must not throw. */
const sanitize = (raw: unknown): Record<string, number> => {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const at = Number(value);
    if (Number.isFinite(at) && at > 0) out[id] = at;
  }
  return out;
};

/** Keep only the `max` most recent markers, so the store cannot grow forever. */
const prune = (markers: Record<string, number>, max: number): Record<string, number> => {
  const ordered = Object.entries(markers).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(ordered.slice(0, Math.max(0, max)));
};

export const createAgentsViewMarkers = (
  config: AgentsViewMarkersConfig = {},
): AgentsViewMarkers => {
  const key = buildAgentsViewMarkersKey(config);
  const max = config.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const read = async (): Promise<Record<string, number>> => {
    const get = config.storage?.get;
    if (!get) return {};
    try {
      const serialized = await Promise.resolve(get(key));
      if (typeof serialized !== 'string' || serialized.length === 0) return {};
      return sanitize(JSON.parse(serialized));
    } catch {
      return {};
    }
  };

  const markViewed = async (entryId: string, at: number): Promise<void> => {
    const set = config.storage?.set;
    if (!set || !Number.isFinite(at) || at <= 0) return;
    const current = await read();
    // Monotonic: a stale re-read must never move a marker backwards.
    const next = prune({ ...current, [entryId]: Math.max(current[entryId] ?? 0, at) }, max);
    try {
      await Promise.resolve(set(key, JSON.stringify(next)));
    } catch {
      /* storage full or denied — ordering degrades, the list still renders */
    }
  };

  const apply = async (entries: readonly AgentsEntry[]): Promise<AgentsEntry[]> => {
    const markers = await read();
    return entries.map((entry) => {
      const local = markers[entry.id];
      if (local === undefined) return { ...entry };
      // Max of local and server-provided (D6b): "last viewed" is monotonic, so
      // neither source may pull the other backwards.
      return { ...entry, lastViewedAt: Math.max(entry.lastViewedAt ?? 0, local) };
    });
  };

  return { read, markViewed, apply };
};
