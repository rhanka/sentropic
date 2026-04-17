/**
 * In-memory Tab Registry for connected browser tabs.
 *
 * Each tab entry tracks connection metadata, keepalive timestamps, and source.
 * The registry is process-scoped — entries do not survive server restarts.
 */

export type TabSource = 'chrome_plugin' | 'bookmarklet';
export type TabStatus = 'active' | 'disconnected';

export interface TabEntry {
  tab_id: string;
  source: TabSource;
  url: string;
  title: string;
  userId: string;
  connected_at: Date;
  last_seen: Date;
  status: TabStatus;
}

const tabs = new Map<string, TabEntry>();

function generateBookmarkletTabId(): string {
  return `bookmarklet_${crypto.randomUUID()}`;
}

/**
 * Register a new tab. If `tab_id` is empty/missing, auto-assigns one with
 * the `bookmarklet_<uuid>` pattern.
 */
export function register(entry: {
  tab_id?: string;
  source: TabSource;
  url: string;
  title: string;
  userId: string;
}): TabEntry {
  const tab_id = (entry.tab_id || '').trim() || generateBookmarkletTabId();
  const now = new Date();
  const tabEntry: TabEntry = {
    tab_id,
    source: entry.source,
    url: entry.url,
    title: entry.title,
    userId: entry.userId,
    connected_at: now,
    last_seen: now,
    status: 'active',
  };
  tabs.set(tab_id, tabEntry);
  return tabEntry;
}

/**
 * Unregister a tab by id. Returns true if the tab existed.
 */
export function unregister(tab_id: string): boolean {
  return tabs.delete(tab_id);
}

/**
 * Get a single tab entry by id.
 */
export function getTab(tab_id: string): TabEntry | undefined {
  return tabs.get(tab_id);
}

/**
 * List all tabs for a given user.
 */
export function listTabs(userId: string): TabEntry[] {
  const result: TabEntry[] = [];
  for (const entry of tabs.values()) {
    if (entry.userId === userId) {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Resolve the best target tab for a user: the most recently active tab.
 */
export function resolveTarget(userId: string): TabEntry | undefined {
  let best: TabEntry | undefined;
  for (const entry of tabs.values()) {
    if (entry.userId === userId && entry.status === 'active') {
      if (!best || entry.last_seen > best.last_seen) {
        best = entry;
      }
    }
  }
  return best;
}

/**
 * Update the last_seen timestamp of a tab (keepalive).
 * Returns true if the tab existed.
 */
export function touchTab(tab_id: string): boolean {
  const entry = tabs.get(tab_id);
  if (!entry) return false;
  entry.last_seen = new Date();
  entry.status = 'active';
  return true;
}

/**
 * Evict tabs whose last_seen is older than `maxAgeMs` milliseconds.
 * Returns the evicted entries.
 */
export function evictStaleTabs(maxAgeMs: number): TabEntry[] {
  const cutoff = Date.now() - maxAgeMs;
  const evicted: TabEntry[] = [];
  for (const [id, entry] of tabs.entries()) {
    if (entry.last_seen.getTime() < cutoff) {
      evicted.push(entry);
      tabs.delete(id);
    }
  }
  return evicted;
}

/**
 * Clear all entries (useful for tests).
 */
export function clearAll(): void {
  tabs.clear();
}
