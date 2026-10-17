/**
 * L-5a — server ports (spec-v8 §9).
 *
 * Injected host resources for the artifact service: key/value persistence
 * and UUID allocation. The service depends only on these ports — never on a
 * driver, ORM row or network client — so hosts supply Postgres/S3-backed
 * implementations (L-5b) while unit tests inject memory doubles. No eager
 * connections or DDL on import.
 */
export interface KvPort {
  get(key: string): Promise<string | undefined>;
  /** Set only if absent; returns true when this caller won the creation. */
  putIfAbsent(key: string, value: string): Promise<boolean>;
}

export interface UuidPort {
  randomUUID(): string;
}

export interface ServerPorts {
  kv: KvPort;
  uuid: UuidPort;
}

/** In-memory KvPort double for unit tests (single process). */
export function createMemoryKv(): KvPort {
  const store = new Map<string, string>();
  return {
    get(key: string): Promise<string | undefined> {
      return Promise.resolve(store.get(key));
    },
    putIfAbsent(key: string, value: string): Promise<boolean> {
      if (store.has(key)) return Promise.resolve(false);
      store.set(key, value);
      return Promise.resolve(true);
    },
  };
}

/** Crypto-backed UuidPort (Node runtime). */
export function createCryptoUuid(): UuidPort {
  return {
    randomUUID(): string {
      return crypto.randomUUID();
    },
  };
}

export interface KeyMutex {
  runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * In-process per-key mutex: concurrent callers for one key serialize so
 * exactly one creator wins (single-process scope; multi-process fencing
 * belongs to the L-5b Postgres port).
 */
export function createKeyMutex(): KeyMutex {
  const locks = new Map<string, Promise<void>>();
  return {
    async runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = locks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((res) => {
        release = res;
      });
      locks.set(key, current);
      await previous;
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(key) === current) locks.delete(key);
      }
    },
  };
}
