/**
 * L-5a — operation idempotency (spec-v8 §9).
 *
 * One stored result per idempotency key: the first execution runs the work
 * and records {paramsHash, result}; replays with the same key and hash
 * return the stored result without re-executing. A reused key with a
 * different hash is an explicit conflict, never a silent overwrite.
 * Executions serialize per key (in-process mutex) so concurrent replays
 * converge without double work. Persistence goes through the injected
 * KvPort only (ports.ts); the memory double serves unit tests.
 */
import { createKeyMutex, createMemoryKv, type KvPort } from './ports.js';
import { CommitQuarantineError, type ArtifactInvocationContext } from './commit/types.js';
import type { EffectiveArtifactCommand } from './command-identity.js';

/** Known 0.1.x durable key encodings. Their sorted hashes cannot prove command order or authority. */
export async function assertArtifactReplayMigration(
  records: Pick<KvPort, 'get'>,
  command: EffectiveArtifactCommand,
  invocation: ArtifactInvocationContext,
  callerKey: string,
): Promise<void> {
  const { internalKey } = command.identity;
  const artifactId = command.operation === 'publish' ? command.payload.artifactId as string : undefined;
  const keys = new Set<string>([internalKey]);
  for (const key of [callerKey, internalKey]) {
    keys.add(JSON.stringify(command.operation === 'publish'
      ? ['publish', invocation.actorId, artifactId, key] : ['ensure', invocation.actorId, key]));
  }
  for (const key of keys) {
    if (await records.get(`idempotency:${key}`) !== undefined) {
      throw new CommitQuarantineError(invocation.storageScopeId, internalKey, 'legacy-unknown');
    }
  }
}

export interface IdempotentResult<T> {
  result: T;
  replayed: boolean;
}

export interface IdempotencyStore {
  execute<T>(key: string, paramsHash: string, work: () => Promise<T>): Promise<IdempotentResult<T>>;
}

/** Memory-backed KvPort for unit tests (re-exported from the ports module). */
export function createMemoryIdempotencyKv(): KvPort {
  return createMemoryKv();
}

interface StoredRecord {
  paramsHash: string;
  result: unknown;
}

/** Create an idempotency store over an injected KvPort (no driver imports). */
export function createIdempotencyStore(kv: KvPort): IdempotencyStore {
  const mutex = createKeyMutex();
  return {
    execute<T>(key: string, paramsHash: string, work: () => Promise<T>): Promise<IdempotentResult<T>> {
      const storeKey = `idempotency:${key}`;
      return mutex.runSerialized(storeKey, async () => {
        const raw = await kv.get(storeKey);
        if (raw !== undefined) {
          const stored = JSON.parse(raw) as StoredRecord;
          if (stored.paramsHash !== paramsHash) {
            throw new Error(`idempotency conflict: key ${key} already used with different parameters`);
          }
          return { result: stored.result as T, replayed: true };
        }
        const result = await work();
        await kv.putIfAbsent(storeKey, JSON.stringify({ paramsHash, result }));
        return { result, replayed: false };
      });
    },
  };
}
