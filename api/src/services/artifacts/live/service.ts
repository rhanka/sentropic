import { Hono, type Context } from 'hono';
import type { Pool } from 'pg';
import { createHeavyPhaseQueue, type HeavyPhaseBudget } from '@sentropic/cluster-mesh';
import type { LivePorts } from './ports';
import { LiveError, type LiveRuntime } from './records';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage, createPostgresKvRows } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresBuildJobStore, createPostgresLiveStore, createPostgresRemoteLiveRows } from './postgres';
import { createPostgresHeavyQueueStore, createQueuedHeavyGate, gatedInstall, liveHolds } from './heavy';
import { createFairAdmission } from './admission';
import { bindingRowKey, createBuilderPods, podName, type KubernetesCore, type WorkerSizing } from './pods';
import { createLiveWorker } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';
import type { BuilderPlacement } from './placement';
import type { KeyResolver, SigningKey } from '@sentropic/artifacts/live-host';
import { createHandoffPublication, type RemoteHost } from './handoff-publication';
import { createCandidateStore } from './candidate-store';
import { composeSupervisor } from './supervisor-composition';
import type { SupervisorSources } from './supervisor';
import { CACHE_STATE_NAMESPACE, createCacheJobs, createHostCacheApi, PREWARM_ADMISSION_RETRY_MS,
  PREWARM_ADMISSION_WAIT_MS, type CacheJobRecord, type PrewarmExecutor } from './cache-api';
import { createPoolManager, POOL_NAMESPACE } from './pool';
import { createHostPoolApi } from './pool-api';
import { createPhaseEventSink, PHASE_EVENTS_NAMESPACE } from './phase-events';
import { createRelaySupervisorChannel, SUPERVISOR_COMMAND_TIMEOUT_MS } from './supervisor-relay';
import { createBuildJobs, jobForgeBinding, runStaleMs } from './build-jobs';
import { defaultInstallBudget, type InstallBudget } from './deadline';
import { createHostBuildApi, type HostBuildEnv, type HostIdentity } from './host-build-api';
import { createHostLiveApi } from './host-live-api';
import type { SourceSnapshot } from './ports';
import { unconfigured, type ForgeBinding } from './forge-binding';
import { createRemoteLive } from './remote-live';
import { createRemoteDrafts } from './remote-drafts';
import type { ForgeBindings } from './forge-binding';

/** Live sessions admitted per environment (four builder pod slots shared by live and build pods:
 * 1 warm + 2 live/build + 1 prewarm; a 5th admitted session only waits for a pod slot before a `queued` failure). */
export const LIVE_NODE_CAPACITY = 4;
/** Builder pods present at once per environment (tenant ResourceQuota pods 5 admits 4, s-archi 07/11 21:15): every creation
 * takes one of these pod slots in the heavy-phase queue first. */
export const MAX_BUILDER_PODS = 4;
/** API composition: runs as sentropic-app; no listeners, background jobs or production activation here.
 * AL-T supplies authenticated owner operations; AL-D supplies the encrypted draft port;
 * SG4 supplies transactional publication. Every supervisor frame rides the artifact-content relay (A-LIVE §8.1):
 * `relayUrl` is `supervisorRelayUrl(process.env)`; an invalid URL refuses to compose before anything else is built.
 * `supervisorKey(process.env)` signs every frame and is the only key the composed bootstrap trusts (FIX5).
 * `placement` comes from per-environment configuration (`builderPlacement(process.env)`), never a constant.
 */
export function createArtifactLiveService(options: Pick<LivePorts,
  'binding' | 'jobBinding' | 'seedBinding' | 'seedSession' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'
  | 'invitations' | 'events'> & {
    pool: Pool; cacheBlobs: PrivateCacheBlobs; placement: BuilderPlacement;
    /** Namespace-only client of the builder namespace (`createInClusterKubernetes(placement)` in the product). */
    kubernetes: KubernetesCore;
    supervisorKey: SigningKey; relayUrl: string;
    /** Staged source, AL-D draft and candidate sink; the dependency stream is this service's cache. */
    sources: Omit<SupervisorSources, 'dependencies'>;
    /** Builder node (one d2-4), its memory budget for the cluster-mesh heavy-phase queue (1641 MiB, provisional phase
     * costs, 19 MiB measured pod base), its pod slots (per-environment configuration, `MAX_BUILDER_PODS` by default) and
     * the longest interactive wait; tickets renew at a third of the entry TTL. */
    heavy: { node: string; maxWaitMs: number; pollMs: number; budget: HeavyPhaseBudget; maxPods?: number };
    /** Live pod slots of this environment from per-environment configuration; the owner decision is 4 on one d2-4. */
    admission: { capacity?: number; waiterTtlMs: number };
    cache: Pick<CachePorts, 'signingKey'>;
    /** Progress-based bound of the dependency install phase (stall watchdog plus absolute ceiling). */
    installBudget?: InstallBudget;
    /** Worker disk caps (env sizing, safe defaults) and the npm install heap environment. */
    sizing?: WorkerSizing;
    installEnv?: Record<string, string>;
  }) {
  const channel = createRelaySupervisorChannel({ baseUrl: options.relayUrl });
  const store = createPostgresLiveStore(options.pool);
  const { node, maxWaitMs, pollMs, budget } = options.heavy;
  const heavy = createQueuedHeavyGate({ node, maxWaitMs, pollMs, renewMs: budget.entryTtlMs / 3, holds: () => liveHolds(store),
    queue: createHeavyPhaseQueue({ store: createPostgresHeavyQueueStore(options.pool), budget, now: options.now,
      maxPods: options.heavy.maxPods ?? MAX_BUILDER_PODS }) });
  const { bootstrap, supervisor } = composeSupervisor({ key: options.supervisorKey, channel, now: options.now,
    id: options.id, timeoutMs: SUPERVISOR_COMMAND_TIMEOUT_MS, installEnv: options.installEnv,
    sources: { ...options.sources, dependencies: receipt => cache.materialize(receipt) } });
  const cache = createDependencyCache({ ...options.cache, cleanInstall: gatedInstall(heavy, supervisor.cleanInstall),
    fetch: (pin, relay, signal) => fetchLockedTarball(pin, relay, undefined, signal),
    storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) },
  options.installBudget ?? defaultInstallBudget());
  const admission = createFairAdmission({ capacity: options.admission.capacity ?? LIVE_NODE_CAPACITY,
    waiterTtlMs: options.admission.waiterTtlMs, now: options.now, holders: () => store.active() });
  const pods = createBuilderPods(options.kubernetes, bootstrap, options.placement, options.sizing);
  // Warm pod pool (§7.3): durable rows over the same host KV as the heavy queue and the cache state.
  // `options.pool` below is the Postgres pool; the LivePorts pool manager is passed explicitly so the pg
  // handle never leaks into the controller ports.
  const poolManager = createPoolManager(createPostgresKvRows(options.pool, POOL_NAMESPACE), { now: options.now });
  const delay = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
  /** Prewarm seal executor (§7.1.3, §7.1.6): one fresh pod per seal with yielding heavy admission (5 s
   * pod-slot wait retried every 60 s, so a prewarm never starves a user build beyond one in-flight heavy
   * phase). The pod is single-use: removed after the seal whether it succeeded or failed. */
  const prewarmExecutor: PrewarmExecutor = {
    async execute(job: CacheJobRecord, source, progress) {
      const key = { storageScopeId: job.scope, artifactId: `prewarm:${job.jobId}` };
      let runtime: LiveRuntime = { generation: 0, ownerId: 'prewarm', sessionId: job.jobId,
        phase: 'BUILD_PROVISIONING', leaseEpoch: 0, rowVersion: 0, podUid: null, podName: podName(key),
        binding: bindingRowKey(key),
        sourceRevision: source.headSha, appliedRevision: null, baseHeadSha: source.headSha,
        liveTreeSha: source.treeSha, lastAccessAt: options.now(), routeEpoch: 0, invitationEpoch: 0,
        invitationExpiresAt: null, pendingWake: false, attempt: null };
      await progress?.('queued');
      for (;;) {
        try {
          return await heavy.pod(`prewarm:${job.jobId}`, async () => {
            const pod = await pods.ensure(key, runtime);
            runtime = { ...runtime, podUid: pod.uid };
            try {
              await progress?.('seal');
              return await cache.seal({ lockfile: source.lockfile, cacheIdentity: source.cacheIdentity,
                stagingRef: source.stagingRef, gb1: source.gb1, runtime });
            } finally {
              await pods.remove(key, runtime).catch(() => undefined);
              await heavy.hold(runtime.podName, { pod: false }).catch(() => undefined);
              await heavy.cancel(runtime.podName).catch(() => undefined);
            }
          }, { waitMs: PREWARM_ADMISSION_WAIT_MS });
        } catch (error) {
          if (error instanceof LiveError && error.code === 'builder_unavailable' && error.reason === 'queued') {
            await progress?.('queued').catch(() => undefined);
            await delay(PREWARM_ADMISSION_RETRY_MS);
            continue;
          }
          throw error;
        }
      }
    },
  };
  return { controller: createLiveController({ ...options, pool: poolManager, cache, store, admission, heavy, pods,
    worker: createLiveWorker(supervisor, options.placement) }), prewarmExecutor, poolManager };
}
/** M3-B builder service: the live controller composed with the SG4b handoff publication, the Postgres job ledger,
 * the remote host live state (D0: drafts, session invitation state and package fences pushed by the host) and the host API
 * (builds and live). The sealed candidate holder is both the supervisor sink and the SG4b export.
 * Nothing listens or runs until the host composition mounts `api` and supplies `schedule`. */
export function createBuilderService(options: Omit<Parameters<typeof createArtifactLiveService>[0],
  'publication' | 'sources' | 'drafts' | 'invitations' | 'jobBinding' | 'seedBinding' | 'seedSession'> & {
  sources: Pick<SupervisorSources, 'source'>;
  host: RemoteHost; signingKey(): SigningKey; hostKeys: KeyResolver;
  /** `hostAuthenticator(parseBuilderHostBindings(...))` over the S2S guard of the builder mount. */
  authenticate(c: Context): HostIdentity | null; schedule(work: () => Promise<void>): void;
  /** Longest wait of one host reconcile before it answers `ready: false` (the revive keeps running). */
  liveWaitMs: number;
  /** Host git bindings (forge-lease-reader contract §1), validated and recorded before anything is scheduled. */
  forgeBindings: Pick<ForgeBindings, 'admit' | 'validate'>;
  /** Repo-scoped forge read for the prewarm trigger (§7.1.3): identity equality with the user path is
   * load-bearing, so this must be the same snapshot machinery (e.g. `reads.snapshotRepo`). Absent keeps
   * the prewarm endpoints refusing `forge_unconfigured` instead of composing a second lease client here. */
  forgeSnapshot?: (scope: string, binding: ForgeBinding, commitSha: string) => Promise<SourceSnapshot>;
  /** `ARTIFACT_POOL_ADMIN=1` (preprod only by configuration): enables `POST /v1/pool/drain`. */
  poolAdmin?: boolean;
}) {
  const jobs = createBuildJobs(createPostgresBuildJobStore(options.pool), options.now, options.id,
    runStaleMs(options.heavy.maxWaitMs, options.installBudget?.ceilingMs));
  const candidates = createCandidateStore();
  const publication = createHandoffPublication({ host: options.host, candidates, outcomes: jobs,
    signingKey: options.signingKey, hostKeys: options.hostKeys, now: options.now });
  const rows = createPostgresRemoteLiveRows(options.pool);
  const remote = createRemoteLive(rows); const drafts = createRemoteDrafts(rows);
  const { controller, prewarmExecutor, poolManager } = createArtifactLiveService({ ...options, publication,
    jobBinding: jobForgeBinding(jobs, options.forgeBindings),
    seedBinding: (key, seed) => remote.reconciled(key, seed), seedSession: key => remote.session(key).catch(() => undefined),
    drafts: drafts.drafts, invitations: remote.invitations,
    events: createPhaseEventSink(createPostgresKvRows(options.pool, PHASE_EVENTS_NAMESPACE)),
    sources: { ...options.sources, draft: drafts.draft, candidate: input => candidates.candidate(input) } });
  // A build carries no generation (R1): its validated binding is stored with the job, and the build-only run records it
  // at the HostJob generation right after resolving the job, never at the host's last reconcile.
  const builds = createHostBuildApi({ authenticate: options.authenticate, jobs, schedule: options.schedule,
    validate: options.forgeBindings.validate,
    build: async (key, jobId) => { await controller.buildOnly(key, jobId); } });
  const live = createHostLiveApi({ authenticate: options.authenticate, controller, store: createPostgresLiveStore(options.pool),
    remote, drafts, waitMs: options.liveWaitMs, bind: options.forgeBindings.admit });
  const cacheJobs = createCacheJobs(createPostgresKvRows(options.pool, CACHE_STATE_NAMESPACE),
    { now: options.now, id: options.id });
  const snapshotRepo = options.forgeSnapshot ?? (async () => unconfigured());
  const cacheApi = createHostCacheApi({ authenticate: options.authenticate, jobs: cacheJobs, snapshotRepo,
    executor: prewarmExecutor, schedule: options.schedule,
    // A sealed prewarm registers its key as hot, so renewal holds the pool minimum for it (§7.3.1 D3).
    onSealed: sealed => { void poolManager.noteHot(sealed.scope, sealed.cacheKey).catch(() => undefined); } });
  const poolApi = createHostPoolApi({ authenticate: options.authenticate, pool: poolManager,
    kubernetes: options.kubernetes, now: options.now, admin: options.poolAdmin ?? false });
  const api = new Hono<HostBuildEnv>().route('/', builds).route('/', live).route('/', cacheApi).route('/', poolApi);
  return { controller, api, jobs, remote, drafts, cacheJobs };
}
