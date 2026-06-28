/**
 * Slice 3 — Restart-safe mock persistence primitive.
 *
 * A generic, MOCK-ONLY record store backing the §6.3 lifecycle records, the §6.4
 * secret-status record and the §5.1 elicitation record so their lookups survive a
 * simulated process restart (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §6.3/§6.4/§5.1,
 * §11 "Session persistence" / "Elicitation resume after restart").
 *
 * Two backings implement the same `RecordStore<T>` port:
 * - `MemoryRecordStore` — default, non-durable; a restart is simulated by
 *   `MemoryRecordStore.fromSnapshot(store.snapshot())`.
 * - `FileRecordStore` — durable JSON file under the OS tmp dir (NEVER in the
 *   repo). A real "restart" is a brand-new `FileRecordStore` pointed at the SAME
 *   path: the file is the source of truth, the in-memory map is a write-through
 *   cache rebuilt from disk on construction and on `reload()`.
 *
 * NO real DB/driver/network — deterministic, synchronous file I/O only.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Durable, restart-safe key/value record port. Values MUST be JSON-serializable. */
export interface RecordStore<T> {
  get(key: string): T | undefined;
  put(key: string, value: T): void;
  delete(key: string): void;
  all(): T[];
  keys(): string[];
  /** Serialize every record to a JSON string (for inspection / restart). */
  snapshot(): string;
  /** Re-read the durable medium into the in-memory mirror (restart-safe). */
  reload(): void;
}

function deserialize<T>(json: string): Map<string, T> {
  const obj = JSON.parse(json) as Record<string, T>;
  return new Map(Object.entries(obj));
}

function serialize<T>(mirror: Map<string, T>): string {
  return JSON.stringify(Object.fromEntries(mirror.entries()));
}

/** Non-durable default backing. Restart = `fromSnapshot(snapshot())`. */
export class MemoryRecordStore<T> implements RecordStore<T> {
  readonly #mirror: Map<string, T>;

  constructor(initial?: Map<string, T>) {
    this.#mirror = initial ?? new Map<string, T>();
  }

  static fromSnapshot<T>(json: string): MemoryRecordStore<T> {
    return new MemoryRecordStore<T>(deserialize<T>(json));
  }

  get(key: string): T | undefined {
    return this.#mirror.get(key);
  }

  put(key: string, value: T): void {
    this.#mirror.set(key, value);
  }

  delete(key: string): void {
    this.#mirror.delete(key);
  }

  all(): T[] {
    return [...this.#mirror.values()];
  }

  keys(): string[] {
    return [...this.#mirror.keys()];
  }

  snapshot(): string {
    return serialize(this.#mirror);
  }

  // No external medium: a Memory store cannot reload. Use fromSnapshot() to
  // simulate a restart deterministically.
  reload(): void {}
}

/**
 * Durable JSON-file backing under the OS tmp dir. A new instance at the same
 * `path` rehydrates from disk = a process restart. The in-memory mirror is a
 * write-through cache; the file is the source of truth.
 */
export class FileRecordStore<T> implements RecordStore<T> {
  readonly path: string;
  #mirror: Map<string, T>;

  constructor(path?: string) {
    this.path = path ?? defaultTmpPath();
    this.#mirror = new Map<string, T>();
    this.reload();
  }

  get(key: string): T | undefined {
    return this.#mirror.get(key);
  }

  put(key: string, value: T): void {
    this.#mirror.set(key, value);
    this.#flush();
  }

  delete(key: string): void {
    this.#mirror.delete(key);
    this.#flush();
  }

  all(): T[] {
    return [...this.#mirror.values()];
  }

  keys(): string[] {
    return [...this.#mirror.keys()];
  }

  snapshot(): string {
    return serialize(this.#mirror);
  }

  reload(): void {
    try {
      this.#mirror = deserialize<T>(readFileSync(this.path, 'utf8'));
    } catch {
      this.#mirror = new Map<string, T>(); // absent file → empty (fresh start)
    }
  }

  /** Remove the durable file (test teardown). */
  destroy(): void {
    this.#mirror = new Map<string, T>();
    try {
      rmSync(this.path, { force: true });
    } catch {
      /* already gone */
    }
  }

  #flush(): void {
    mkdirSync(join(this.path, '..'), { recursive: true });
    writeFileSync(this.path, serialize(this.#mirror), 'utf8');
  }
}

function defaultTmpPath(): string {
  return join(tmpdir(), 'sentropic-mcp-platform', `store-${randomUUID()}.json`);
}
