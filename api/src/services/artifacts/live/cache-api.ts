import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { SourceSnapshot } from './ports';
import { cacheKeyOf, type CacheReceipt } from './cache';
import { bindingOf, safeSubPath, type ForgeBinding } from './forge-binding';
import { sha256 } from './integrity';
import { LiveError } from './records';
import { parseInstallWorkspaces } from './workspace-subset';
import type { KvStore } from './cache-storage';
import { closed, refusal } from './host-live-body';
import { hostGate, type HostBuildEnv, type HostIdentity } from './host-build-api';

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
  error?: { code: string; reason?: string; retriable?: boolean };
}
export interface CacheEntryView {
  lockSha256: string; cacheKey: string; state: CacheStateValue; jobId: string; treeSha256?: string; files?: number;
  bytes?: number; sealedAt?: number; step?: string; startedAt?: number; attempts?: number; prebundle?: boolean;
  error?: { code: string; reason?: string; retriable?: boolean };
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
  cacheKey: record.cacheKey, state: record.state, jobId: record.jobId,
  ...(record.sealed ? { treeSha256: record.sealed.treeSha256, files: record.sealed.files,
    bytes: record.sealed.bytes, sealedAt: record.sealed.sealedAt } : {}),
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
          if (current && current.scope !== input.scope) throw new LiveError('access_denied');
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
          ...(code ? { error: { code, ...(reason ? { reason } : {}), retriable: code !== 'lock_mismatch' } } : {}) };
        return { next, result: next };
      });
    },
    async readEntry(cacheKey: string): Promise<CacheEntryView | undefined> {
      const record = await store.read<CacheJobRecord>(canonicalKey(cacheKey));
      return record ? entryView(record) : undefined;
    },
    /** Full job record for scope-checked reads (by-key isolation, §5.4): callers must verify
     * `record.scope` against the authenticated scope before exposing the view. */
    async readRecord(cacheKey: string): Promise<CacheJobRecord | undefined> {
      return store.read<CacheJobRecord>(canonicalKey(cacheKey));
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
    /** Workspace-variant listing (§7.1.3): when the host polls without `installWorkspaces`, returns every
     * sealed/building/failed variant indexed for the lockfile instead of only the exact (root) alias. */
    async readVariants(input: { scope: string; repoId: string; subPath: string;
      lockSha256: string }): Promise<CacheEntryView[]> {
      const aliases = await store.read<string[]>(indexKey(input.scope, input.repoId, input.subPath,
        input.lockSha256));
      if (!aliases?.length) return [];
      const out: CacheEntryView[] = [];
      for (const alias of aliases) {
        const ref = await store.read<{ cacheKey: string }>(alias);
        if (!ref) continue;
        const record = await store.read<CacheJobRecord>(canonicalKey(ref.cacheKey));
        if (record) out.push(entryView(record));
      }
      return out;
    },
  };
}
export type CacheJobs = ReturnType<typeof createCacheJobs>;

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const TEXT = /^[\x21-\x7e]{1,256}$/;
const REF_KINDS = ['branch', 'tag', 'commit'] as const;
const PREWARM_BODY = ['binding', 'commitSha', 'refKind', 'lockSha256'];
const PREWARM_OPTIONAL = ['installWorkspaces', 'prebundle', 'idempotencyKey'];
/** Closed prewarm trigger body (§7.1.3): unknown fields refuse, like every host body. */
function prewarmBody(value: unknown): {
  binding: ForgeBinding; commitSha: string; refKind: 'branch' | 'tag' | 'commit'; lockSha256: string;
  installWorkspaces?: readonly string[]; prebundle: boolean; idempotencyKey?: string;
} | null {
  if (!closed(value, PREWARM_BODY, PREWARM_OPTIONAL)) return null;
  const binding = bindingOf(value.binding);
  if (!binding) return null;
  if (typeof value.commitSha !== 'string' || !SHA40.test(value.commitSha)) return null;
  if (typeof value.refKind !== 'string' || !(REF_KINDS as readonly string[]).includes(value.refKind)) return null;
  if (typeof value.lockSha256 !== 'string' || !SHA64.test(value.lockSha256)) return null;
  let installWorkspaces: readonly string[] | undefined;
  if (value.installWorkspaces !== undefined) {
    const parsed = parseInstallWorkspaces(value.installWorkspaces);
    if (!parsed) return null;
    installWorkspaces = parsed;
  }
  if (value.prebundle !== undefined && typeof value.prebundle !== 'boolean') return null;
  if (value.idempotencyKey !== undefined
    && (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length === 0
      || value.idempotencyKey.length > 128)) return null;
  return { binding, commitSha: value.commitSha, refKind: value.refKind as 'branch' | 'tag' | 'commit',
    lockSha256: value.lockSha256, ...(installWorkspaces ? { installWorkspaces } : {}),
    prebundle: value.prebundle ?? true,
    ...(typeof value.idempotencyKey === 'string' ? { idempotencyKey: value.idempotencyKey } : {}) };
}
/** Sealed view of one entry: already sealed answers 200, new or in-progress answers 202. */
const sealedView = (entry: CacheEntryView) => ({ lockSha256: entry.lockSha256, cacheKey: entry.cacheKey,
  state: entry.state, treeSha256: entry.treeSha256!, files: entry.files!, bytes: entry.bytes!,
  sealedAt: entry.sealedAt! });
const buildingView = (entry: { lockSha256: string; cacheKey: string; jobId: string; startedAt: number }) =>
  ({ lockSha256: entry.lockSha256, cacheKey: entry.cacheKey, state: 'building' as const, jobId: entry.jobId,
    startedAt: entry.startedAt });

/** Yielding prewarm admission (§7.1.6): the pod slot is attempted with a 5 s wait, retried every 60 s, so a
 * prewarm for the next lockfile never starves a user build beyond one in-flight heavy phase. */
export const PREWARM_ADMISSION_WAIT_MS = 5_000;
export const PREWARM_ADMISSION_RETRY_MS = 60_000;
/** Seal execution on a prewarm builder pod (composed in `service.ts`, beside the user-path cache). */
export interface PrewarmExecutor {
  execute(job: CacheJobRecord, source: SourceSnapshot,
    progress?: (step: string) => Promise<void>): Promise<CacheReceipt>;
}
/** Prewarm trigger contract (§7.1.3) on the existing builder mount, behind the same hostGate S2S authentication
 * (scope `artifacts:builder`). Derives the complete `CacheIdentity` through the same snapshot machinery the
 * user path uses — identity equality is load-bearing — and verifies the pinned lockfile before admitting. */
export function createHostCacheApi(options: {
  /** Host identity of the verified service client; null refuses before the body is read. */
  authenticate(c: Context): HostIdentity | null;
  jobs: CacheJobs;
  /** Repo-scoped forge read building its target through the registry admission (never a generation binding row). */
  snapshotRepo(scope: string, binding: ForgeBinding, commitSha: string): Promise<SourceSnapshot>;
  /** Runs `seal()` on a prewarm builder pod with yielding heavy admission (§7.1.6, 5 s wait retried every 60 s). */
  executor: PrewarmExecutor;
  /** Background seal runner owned by the composition; nothing starts on import. */
  schedule(work: () => Promise<void>): void;
}) {
  const app = new Hono<HostBuildEnv>();
  app.use('*', hostGate(options.authenticate));
  const keyOf = (c: Context<HostBuildEnv>): string => c.get('identity').storageScopeId;
  async function settle(job: CacheJobRecord, source: SourceSnapshot): Promise<void> {
    try {
      const progress = async (step: string) => {
        await options.jobs.heartbeat(job.cacheKey, job.jobId, step).catch(() => undefined);
      };
      await progress('snapshot_ready');
      const receipt = await options.executor.execute(job, source, progress);
      await options.jobs.completeSeal(job.cacheKey, job.jobId, { treeSha256: receipt.treeSha256,
        files: receipt.files ?? receipt.inventory.length, bytes: receipt.archive?.bytes ?? 0 });
    } catch (error) {
      const code = error instanceof LiveError ? error.code : 'builder_unavailable';
      const reason = error instanceof LiveError ? error.reason : undefined;
      await options.jobs.fail(job.cacheKey, job.jobId, code, reason).catch(() => undefined);
    }
  }
  app.post('/v1/cache/prewarm', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'payload_too_large' }, 413) }),
    async c => {
      const raw = await c.req.text();
      let parsed: ReturnType<typeof prewarmBody>;
      try { parsed = prewarmBody(JSON.parse(raw)); } catch { parsed = null; }
      if (!parsed) return c.json({ error: 'invalid_request' }, 400);
      const scope = keyOf(c);
      let source: SourceSnapshot;
      try { source = await options.snapshotRepo(scope, parsed.binding, parsed.commitSha); }
      catch (error) { return refusal(c, error); }
      // The host never supplies lockfile bytes: the builder verifies its pinned snapshot against the claim.
      if (sha256(source.lockfile) !== parsed.lockSha256) {
        return c.json({ error: 'lock_mismatch', reason: 'lockfile_mismatch' }, 422);
      }
      // `installWorkspaces` is an assertion over the builder's own registry selection, never an input to it.
      const derived = [...source.cacheIdentity.installWorkspaces].sort();
      if (parsed.installWorkspaces
        && (parsed.installWorkspaces.length !== derived.length
          || parsed.installWorkspaces.some((name, index) => name !== derived[index]))) {
        return c.json({ error: 'lock_mismatch', reason: 'install_workspaces_mismatch' }, 422);
      }
      const workspaces = parsed.installWorkspaces ?? derived;
      const cacheKey = cacheKeyOf(source.cacheIdentity);
      let ensured: { record: CacheJobRecord; created: boolean };
      try {
        ensured = await options.jobs.ensure({ scope, cacheKey, lockSha256: parsed.lockSha256,
          refKind: parsed.refKind, branch: parsed.binding.branch, installWorkspaces: workspaces,
          prebundle: parsed.prebundle,
          ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}) });
        await options.jobs.alias({ scope, repoId: parsed.binding.repoId, subPath: parsed.binding.subPath,
          lockSha256: parsed.lockSha256, installWorkspaces: workspaces, cacheKey });
      } catch (error) { return refusal(c, error); }
      const { record, created } = ensured;
      if (record.state === 'sealed') {
        const entry = await options.jobs.readEntry(cacheKey);
        if (entry?.state === 'sealed') return c.json(sealedView(entry));
      }
      if (created) {
        const job = record;
        options.schedule(() => settle(job, source));
      }
      return c.json(buildingView({ lockSha256: record.lockSha256, cacheKey, jobId: record.jobId,
        startedAt: record.startedAt }), 202);
    });
  app.get('/v1/cache', async c => {
    const query = c.req.query();
    const keys = Object.keys(query);
    if (keys.some(key => !['lockSha256', 'repoId', 'subPath', 'installWorkspaces'].includes(key))) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const { lockSha256, repoId } = query as Record<string, string | undefined>;
    if (typeof lockSha256 !== 'string' || !SHA64.test(lockSha256) || typeof repoId !== 'string'
      || !TEXT.test(repoId)) return c.json({ error: 'invalid_request' }, 400);
    const subPath = query.subPath ?? '';
    if (typeof subPath !== 'string' || !safeSubPath(subPath)) return c.json({ error: 'invalid_request' }, 400);
    const hasWorkspaces = query.installWorkspaces !== undefined;
    let installWorkspaces: readonly string[] = [];
    if (hasWorkspaces) {
      if (typeof query.installWorkspaces !== 'string') return c.json({ error: 'invalid_request' }, 400);
      const parsed = parseInstallWorkspaces(query.installWorkspaces === ''
        ? [] : query.installWorkspaces.split(','));
      if (!parsed) return c.json({ error: 'invalid_request' }, 400);
      installWorkspaces = parsed;
    }
    try {
      const entries = hasWorkspaces
        ? await options.jobs.readVariant({ scope: keyOf(c), repoId, subPath, lockSha256, installWorkspaces })
        : await options.jobs.readVariants({ scope: keyOf(c), repoId, subPath, lockSha256 });
      return c.json({ entries });
    } catch (error) { return refusal(c, error); }
  });
  app.get('/v1/cache/by-key', async c => {
    const query = c.req.query();
    if (Object.keys(query).sort().join() !== 'cacheKey' || typeof query.cacheKey !== 'string'
      || !/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(query.cacheKey)) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    try {
      const record = await options.jobs.readRecord(query.cacheKey);
      if (!record || record.scope !== keyOf(c)) return c.json({ error: 'not_found' }, 404);
      const entry = await options.jobs.readEntry(query.cacheKey);
      return entry ? c.json(entry) : c.json({ error: 'not_found' }, 404);
    } catch (error) { return refusal(c, error); }
  });
  return app;
}
