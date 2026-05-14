/**
 * BR14b Lot 15.5 — InMemoryCheckpointStore.
 *
 * Generic reference adapter for the `CheckpointStore<T>` port.
 * Mandated by SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5.
 *
 * Behavior mirrors `PostgresChatCheckpointAdapter` with the lenient
 * version strategy (expectedVersion is informational only and never
 * blocks saves; version increments on every successful save).
 *
 * `tag` and `fork` mirror the postgres adapter and throw — the chat
 * domain does not exercise either today, and surfacing the gap loudly
 * prevents silently dropping metadata.
 */
import type {
  CheckpointMeta,
  CheckpointStore,
  SaveResult,
} from '../checkpoint-port.js';

type Entry<T> = {
  state: T;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export class InMemoryCheckpointStore<T> implements CheckpointStore<T> {
  private rows = new Map<string, Entry<T>>();

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.rows.clear();
  }

  /** Test helper — read raw entry without coupling to load. */
  raw(key: string): Entry<T> | undefined {
    const entry = this.rows.get(key);
    return entry ? { ...entry, tags: [...entry.tags] } : undefined;
  }

  async load(key: string): Promise<{ state: T; version: number } | null> {
    const entry = this.rows.get(key);
    if (!entry) return null;
    return { state: entry.state, version: entry.version };
  }

  async save(
    key: string,
    state: T,
    _expectedVersion?: number,
  ): Promise<SaveResult> {
    const now = new Date().toISOString();
    const existing = this.rows.get(key);
    const version = existing ? existing.version + 1 : 1;
    this.rows.set(key, {
      state,
      version,
      tags: existing?.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    // Lenient strategy: expectedVersion is ignored.
    return { version, success: true };
  }

  async list(
    prefix?: string,
    limit?: number,
  ): Promise<ReadonlyArray<CheckpointMeta>> {
    const effectiveLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit as number), 1), 100)
      : 20;
    // Mirrors postgres adapter behavior: without a prefix, return [] rather
    // than scan everything. Chat domain always passes the sessionId.
    if (!prefix) return [];

    const matching = [...this.rows.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, effectiveLimit);

    return matching.map(([key, entry]) => ({
      key,
      version: entry.version,
      tags: entry.tags.length > 0 ? [...entry.tags] : undefined,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  async tag(_key: string, _label: string): Promise<void> {
    throw new Error('InMemoryCheckpointStore.tag not implemented yet');
  }

  async fork(_sourceKey: string, _targetKey: string): Promise<void> {
    throw new Error('InMemoryCheckpointStore.fork not implemented yet');
  }
}
