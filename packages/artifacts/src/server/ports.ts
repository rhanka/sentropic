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
 * G1 sharing policy port (converged-r2 §2.2, lock 2 of the double lock).
 * Resolved by the host per storage scope, inside the commit transaction and
 * at each anonymous read; never derived from tool arguments. Absent, throwing
 * or malformed answers fail closed.
 */
export interface SharingPolicyPort {
  getSharingPolicy(scope: string): Promise<{ allowPublicSharing: boolean; policyRevision: string }>;
}

export interface SharingPolicy {
  allowPublicSharing: boolean;
  policyRevision: string;
}

/** Fail-closed policy used whenever no well-formed answer exists. */
export const CLOSED_SHARING_POLICY: SharingPolicy = Object.freeze({ allowPublicSharing: false, policyRevision: 'none' });

/** Resolve the runtime lock fail-closed: absent port, throw or malformed answer ⇒ closed. */
export async function resolveSharingPolicy(
  port: SharingPolicyPort | undefined,
  scope: string,
): Promise<SharingPolicy> {
  if (port === undefined) return CLOSED_SHARING_POLICY;
  try {
    const policy = await port.getSharingPolicy(scope);
    if (typeof policy?.allowPublicSharing !== 'boolean' ||
      typeof policy?.policyRevision !== 'string' || policy.policyRevision.length === 0) {
      return CLOSED_SHARING_POLICY;
    }
    return { allowPublicSharing: policy.allowPublicSharing, policyRevision: policy.policyRevision };
  } catch {
    return CLOSED_SHARING_POLICY;
  }
}

/**
 * Combine both locks of the double lock: the profile capability (lock 1,
 * deployment) AND the runtime port (lock 2, revocable). The public mode is
 * effective only when both allow it; the revision stays the runtime one so
 * receipts and audit events carry it (never hashed into the command).
 */
export function combineSharingPolicy(
  profileAllows: boolean | undefined,
  runtime: SharingPolicy,
): SharingPolicy {
  return { allowPublicSharing: profileAllows === true && runtime.allowPublicSharing,
    policyRevision: runtime.policyRevision };
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
