import type { KvStore } from './cache-storage';

/** Durable cache-state namespace (§7.1.3): one canonical row per `cacheKey`, one alias row per host-queried
 * identity variant, one variant index per lockfile. No schema change — same host KV as the heavy queue. */
export const CACHE_STATE_NAMESPACE = 'artifact-builder-cache-state/v1';
/** A building job whose heartbeat is older than this is retaken by the next trigger (the seal's own ceiling
 * lands `failed` first on a live runner; this covers a dead runner). Ceiling 15 min + 5 min margin. */
export const CACHE_JOB_STALE_MS_DEFAULT = 1_200_000;
export type CacheStateValue = 'absent' | 'building' | 'sealed' | 'failed';
export interface CacheJobRecord {
  scope: string; cacheKey: string; lockSha256: string; refKind: 'branch' | 'tag' | 'commit'; branch: string;
  state: CacheStateValue; jobId: string; startedAt: number; step?: string; heartbeatAt: number; attempts: number;
  prebundle: boolean; idempotencyKey?: string;
  sealed?: { treeSha256: string; files: number; bytes: number; sealedAt: number };
  error?: { code: string; reason?: string };
}
export interface CacheEntryView {
  lockSha256: string; cacheKey: string; state: CacheStateValue; treeSha256?: string; files?: number; bytes?: number;
  sealedAt?: number; jobId?: string; step?: string; startedAt?: number; attempts?: number; prebundle?: boolean;
  error?: { code: string; reason?: string };
}
export interface PrewarmEnsureInput {
  scope: string; cacheKey: string; lockSha256: string; refKind: 'branch' | 'tag' | 'commit'; branch: string;
  installWorkspaces: readonly string[]; prebundle: boolean; idempotencyKey?: string;
}
const canonicalKey = (cacheKey: string) => `cache:${cacheKey}`;
const aliasKey = (scope: string, repoId: string, subPath: string, lockSha256: string,
  installWorkspaces: readonly string[]) =>
  `lock:${scope}:${repoId}:${subPath || 'root'}:${lockSha256}:${[...installWorkspaces].sort().join(',')}`;
const indexKey = (scope: string, repoId: string, subPath: string, lockSha256: string) =>
  `variants:${scope}:${repoId}:${subPath || 'root'}:${lockSha256}`;
const entryView = (record: CacheJobRecord): CacheEntryView => ({ lockSha256: record.lockSha256,
  cacheKey: record.cacheKey, state: record.state,
  ...(record.sealed ? { treeSha256: record.sealed.treeSha256, files: record.sealed.files,
    bytes: record.sealed.bytes, sealedAt: record.sealed.sealedAt } : {}),
  ...(record.state === 'building' || record.state === 'failed' ? { jobId: record.jobId } : {}),
  ...(record.step ? { step: record.step } : {}),
  startedAt: record.startedAt, attempts: record.attempts, prebundle: record.prebundle,
  ...(record.error ? { error: record.error } : {}) });

/** Durable prewarm job ledger (§7.1.3): compare-and-swap admission on the canonical state row — only the
 * current job token may heartbeat, complete or fail the seal. Joins are idempotent per `cacheKey`. */
export function createCacheJobs(store: KvStore, options: { now(): number; id(): string; staleMs?: number }) {
  const now = options.now; const id = options.id; const staleMs = options.staleMs ?? CACHE_JOB_STALE_MS_DEFAULT;
  const stale = (record: CacheJobRecord) => record.state === 'building' && now() - record.heartbeatAt > staleMs;
  return {
    /** Admit a new building job or join the in-flight/sealed one. Re-takes stale, failed or absent rows. */
    async ensure(input: PrewarmEnsureInput): Promise<{ record: CacheJobRecord; created: boolean }> {
      const at = now();
      const result = await store.update<CacheJobRecord, { record: CacheJobRecord; created: boolean }>(
        canonicalKey(input.cacheKey), current => {
          if (!current || current.state === 'failed' || current.state === 'absent' || stale(current)) {
            const next: CacheJobRecord = { scope: input.scope, cacheKey: input.cacheKey, lockSha256: input.lockSha256,
              refKind: input.refKind, branch: input.branch, state: 'building', jobId: id(), startedAt: at,
              step: 'queued', heartbeatAt: at, attempts: (current?.attempts ?? 0) + 1, prebundle: input.prebundle,
              ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
            return { next, result: { record: next, created: true } };
          }
          return { result: { record: current, created: false } };
        });
      return result;
    },
    /** Record the host-queried identity variant alias and index after a creation (`ensure` above). */
    async alias(input: { scope: string; repoId: string; subPath: string; lockSha256: string;
      installWorkspaces: readonly string[]; cacheKey: string }): Promise<void> {
      await store.update<{ cacheKey: string }, void>(aliasKey(input.scope, input.repoId, input.subPath,
        input.lockSha256, input.installWorkspaces), () => ({ next: { cacheKey: input.cacheKey }, result: undefined }));
      await store.update<string[], void>(indexKey(input.scope, input.repoId, input.subPath, input.lockSha256),
        current => {
          const alias = aliasKey(input.scope, input.repoId, input.subPath, input.lockSha256, input.installWorkspaces);
          const next = current?.includes(alias) ? current : [...(current ?? []), alias];
          return { next, result: undefined };
        });
    },
    async heartbeat(cacheKey: string, jobId: string, step: string): Promise<boolean> {
      return store.update<CacheJobRecord, boolean>(canonicalKey(cacheKey), current => {
        if (!current || current.jobId !== jobId || current.state !== 'building') return { result: false };
        return { next: { ...current, step, heartbeatAt: now() }, result: true };
      });
    },
    async completeSeal(cacheKey: string, jobId: string,
      sealed: { treeSha256: string; files: number; bytes: number }): Promise<CacheJobRecord | undefined> {
      const at = now();
      return store.update<CacheJobRecord, CacheJobRecord | undefined>(canonicalKey(cacheKey), current => {
        if (!current || current.jobId !== jobId || current.state !== 'building') return { result: undefined };
        const next: CacheJobRecord = { ...current, state: 'sealed', step: undefined, heartbeatAt: at,
          sealed: { ...sealed, sealedAt: at }, error: undefined };
        return { next, result: next };
      });
    },
    async fail(cacheKey: string, jobId: string, code: string, reason?: string): Promise<CacheJobRecord | undefined> {
      return store.update<CacheJobRecord, CacheJobRecord | undefined>(canonicalKey(cacheKey), current => {
        if (!current || current.jobId !== jobId || current.state !== 'building') return { result: undefined };
        const next: CacheJobRecord = { ...current, state: 'failed', step: undefined, heartbeatAt: now(),
          ...(code ? { error: { code, ...(reason ? { reason } : {}) } } : {}) };
        return { next, result: next };
      });
    },
    async readEntry(cacheKey: string): Promise<CacheEntryView | undefined> {
      const record = await store.read<CacheJobRecord>(canonicalKey(cacheKey));
      return record ? entryView(record) : undefined;
    },
    /** Exact-variant state poll backing `GET /v1/cache`: alias → canonical → view. */
    async readVariant(input: { scope: string; repoId: string; subPath: string; lockSha256: string;
      installWorkspaces: readonly string[] }): Promise<CacheEntryView[]> {
      const alias = await store.read<{ cacheKey: string }>(aliasKey(input.scope, input.repoId, input.subPath,
        input.lockSha256, input.installWorkspaces));
      if (!alias) return [];
      const record = await store.read<CacheJobRecord>(canonicalKey(alias.cacheKey));
      return record ? [entryView(record)] : [];
    },
  };
}
export type CacheJobs = ReturnType<typeof createCacheJobs>;
