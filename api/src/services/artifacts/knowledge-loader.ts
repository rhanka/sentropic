import { createHash } from 'node:crypto';

export interface KnowledgeDescriptor { repoId: string; commitSha: string; path: string; digest: string }
export const isKnowledgeEnabled = (): boolean => process.env.CM_KNOWLEDGE_ENABLED === '1';

const isHex = (value: unknown, length: number): boolean =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);

export function verifyKnowledgeDescriptor(input: unknown):
  { ok: true; value: KnowledgeDescriptor } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'not_an_object' };
  const d = input as Record<string, unknown>;
  if (typeof d.repoId !== 'string' || !d.repoId) return { ok: false, reason: 'unknown_repo' };
  if (!isHex(d.commitSha, 40)) return { ok: false, reason: 'commit_not_pinned' };
  if (typeof d.path !== 'string' || !d.path || d.path.includes('..')) return { ok: false, reason: 'path_refused' };
  if (!isHex(d.digest, 64)) return { ok: false, reason: 'knowledge_digest_mismatch' };
  return { ok: true, value: d as unknown as KnowledgeDescriptor };
}

export function verifyKnowledgeBytes(descriptor: KnowledgeDescriptor, bytes: Uint8Array):
  { ok: true } | { ok: false; reason: string } {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return digest === descriptor.digest ? { ok: true } : { ok: false, reason: 'knowledge_digest_mismatch' };
}

const cacheKey = (d: KnowledgeDescriptor): string => `${d.repoId}:${d.commitSha}:${d.digest}`;

/**
 * Stored verified bundle. Part A storage lane (feat/t4a-cm-artifact-storage)
 * owns the durable scope blob + DB row keyed by (repoId, commitSha, digest);
 * this stub keeps the verified bytes in memory behind CM_KNOWLEDGE_ENABLED so
 * serving never depends on GitHub reachability.
 */
export function createKnowledgeStore() {
  const stored = new Map<string, Uint8Array>();
  return {
    async load(descriptor: unknown, fetch: () => Promise<Uint8Array>): Promise<Uint8Array> {
      if (!isKnowledgeEnabled()) throw new Error('Knowledge loader is disabled');
      const checked = verifyKnowledgeDescriptor(descriptor);
      if (!checked.ok) throw new Error(checked.reason);
      const pinned = checked.value;
      const key = cacheKey(pinned);
      const cached = stored.get(key);
      if (cached) return cached;
      try {
        const bytes = await fetch();
        const verified = verifyKnowledgeBytes(pinned, bytes);
        if (!verified.ok) throw new Error(verified.reason);
        stored.set(key, bytes);
        return bytes;
      } catch (error) {
        const retry = stored.get(key);
        if (retry) return retry;
        throw error;
      }
    },
    get(descriptor: KnowledgeDescriptor): Uint8Array | undefined {
      return stored.get(cacheKey(descriptor));
    },
  };
}
export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>;
