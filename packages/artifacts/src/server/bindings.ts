/**
 * L-5a — owner-scoped stable bindings (spec-v8 §9).
 *
 * A logical binding (owner + name) resolves to one server-allocated UUID no
 * matter which client ensures it first; both fresh clients converge on the
 * same identity. Another owner resolves nothing: lookup is always qualified
 * by ownerId, so binding names and digests cannot be guessed across owners.
 * A conflicting storage scope on an existing binding fails closed (mappings
 * stay server-verified; ambiguous mappings never silently win). Concurrent
 * ensures serialize on a per-key singleflight so exactly one creation wins.
 * Persistence goes through the injected KvPort only (ports.ts).
 */
import {
  createCryptoUuid,
  createKeyMutex,
  createMemoryKv,
  type KvPort,
  type UuidPort,
} from './ports.js';

export interface BindingInput {
  ownerId: string;
  storageScopeId: string;
  bindingName: string;
}

export interface BindingLookup {
  ownerId: string;
  bindingName: string;
}

export interface BindingResult {
  artifactId: string;
  created: boolean;
}

export interface BindingService {
  ensure(input: BindingInput): Promise<BindingResult>;
  find(lookup: BindingLookup): Promise<string | undefined>;
}

interface StoredBinding {
  artifactId: string;
  storageScopeId: string;
}

function bindingKey(ownerId: string, bindingName: string): string {
  return `binding:${ownerId}:${bindingName}`;
}

/** Memory-backed KvPort for unit tests (re-exported from the ports module). */
export function createMemoryBindingKv(): KvPort {
  return createMemoryKv();
}

/** Create a binding service over an injected KvPort (no driver imports). */
export function createBindingService(kv: KvPort, uuid: UuidPort = createCryptoUuid()): BindingService {
  const mutex = createKeyMutex();

  async function read(key: string): Promise<StoredBinding | undefined> {
    const raw = await kv.get(key);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as StoredBinding;
  }

  async function ensureOnce(input: BindingInput): Promise<BindingResult> {
    const key = bindingKey(input.ownerId, input.bindingName);
    const found = await read(key);
    if (found !== undefined) {
      if (found.storageScopeId !== input.storageScopeId) {
        throw new Error(
          `binding scope mismatch for ${input.bindingName}: ambiguous mappings fail closed`,
        );
      }
      return { artifactId: found.artifactId, created: false };
    }
    const candidate: StoredBinding = { artifactId: uuid.randomUUID(), storageScopeId: input.storageScopeId };
    const won = await kv.putIfAbsent(key, JSON.stringify(candidate));
    if (won) return { artifactId: candidate.artifactId, created: true };
    const raced = await read(key);
    if (raced === undefined) throw new Error(`binding lost for ${input.bindingName}`);
    if (raced.storageScopeId !== input.storageScopeId) {
      throw new Error(
        `binding scope mismatch for ${input.bindingName}: ambiguous mappings fail closed`,
      );
    }
    return { artifactId: raced.artifactId, created: false };
  }

  return {
    ensure(input: BindingInput): Promise<BindingResult> {
      return mutex.runSerialized(bindingKey(input.ownerId, input.bindingName), () =>
        ensureOnce(input),
      );
    },
    async find(lookup: BindingLookup): Promise<string | undefined> {
      const stored = await read(bindingKey(lookup.ownerId, lookup.bindingName));
      return stored?.artifactId;
    },
  };
}
