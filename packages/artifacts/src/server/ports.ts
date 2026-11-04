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
 * G2 principal directory port (converged-r2 §2.3). The host-trusted side of
 * the model boundary: it knows internal principal ids and full emails; the
 * package resolves opaque `userRef`s to internal principals and projects every
 * model-visible output back to `userRef` + masked `emailHint`. Search and
 * resolution are scope-filtered; approval is NOT part of resolution — every
 * resolution/approval failure merges into the single `person_not_shareable`.
 */
export interface DirectoryPerson {
  /** Opaque model-facing reference; the only principal form a model may see or send back. */
  readonly userRef: string;
  readonly displayName: string;
  /** Full email, host-side only; never projected to a model payload. */
  readonly email: string;
}

export interface PrincipalDirectoryPort {
  /** Approved accounts of the scope matching the query (case/accent-insensitive on name and email). */
  searchPeople(scope: string, query: string, limit: number): Promise<readonly DirectoryPerson[]>;
  /** Resolve one opaque userRef to the internal principal id; undefined when unknown or out of scope. */
  resolvePrincipal(scope: string, userRef: string): Promise<string | undefined>;
  /** Inverse projection: internal principal id → directory person (userRef/displayName/email). */
  describePrincipal(scope: string, principalId: string): Promise<DirectoryPerson | undefined>;
}

/**
 * R1 typed unknown principal (review 1002): every model-visible projection of
 * an internal principal whose directory entry is missing emits this opaque
 * value instead of the raw internal id (`sub`). It never resolves back to a
 * principal, so re-injecting it fails closed with `person_not_shareable`.
 */
export const UNKNOWN_USER_REF = 'unknown';

/**
 * Mask an email for model payloads: first local-part character kept, rest of
 * the local part masked, domain visible — lifts homonyms without disclosing
 * the directory. The package masks, so no full email can reach the wire.
 */
export function maskEmailHint(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
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
