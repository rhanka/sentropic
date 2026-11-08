import { Hono, type Context } from 'hono';
import type { Pool } from 'pg';
import { createHeavyPhaseQueue, type HeavyPhaseBudget } from '@sentropic/cluster-mesh';
import type { LivePorts } from './ports';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresBuildJobStore, createPostgresLiveStore, createPostgresRemoteLiveRows } from './postgres';
import { createPostgresHeavyQueueStore, createQueuedHeavyGate, gatedInstall, liveHolds } from './heavy';
import { createFairAdmission } from './admission';
import { createBuilderPods, type KubernetesCore } from './pods';
import { createLiveWorker } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';
import type { BuilderPlacement } from './placement';
import type { KeyResolver, SigningKey } from '@sentropic/artifacts/live-host';
import { createHandoffPublication, type RemoteHost } from './handoff-publication';
import { createCandidateStore } from './candidate-store';
import { composeSupervisor } from './supervisor-composition';
import type { SupervisorSources } from './supervisor';
import { createRelaySupervisorChannel, SUPERVISOR_COMMAND_TIMEOUT_MS } from './supervisor-relay';
import { createBuildJobs, jobForgeBinding, runStaleMs } from './build-jobs';
import { createHostBuildApi, type HostBuildEnv, type HostIdentity } from './host-build-api';
import { createHostLiveApi } from './host-live-api';
import { createRemoteLive } from './remote-live';
import { createRemoteDrafts } from './remote-drafts';
import type { ForgeBindings } from './forge-binding';

/** Live pods admitted on one d2-4 node (owner decision 07/11); memory admission is the heavy-phase queue's. */
export const LIVE_NODE_CAPACITY = 4;
/** Builder pods present at once per environment (tenant ResourceQuota pods 5, s-archi 07/11 21:15): every creation
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
  'binding' | 'jobBinding' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'
  | 'invitations'> & {
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
  }) {
  const channel = createRelaySupervisorChannel({ baseUrl: options.relayUrl });
  const store = createPostgresLiveStore(options.pool);
  const { node, maxWaitMs, pollMs, budget } = options.heavy;
  const heavy = createQueuedHeavyGate({ node, maxWaitMs, pollMs, renewMs: budget.entryTtlMs / 3, holds: () => liveHolds(store),
    queue: createHeavyPhaseQueue({ store: createPostgresHeavyQueueStore(options.pool), budget, now: options.now,
      maxPods: options.heavy.maxPods ?? MAX_BUILDER_PODS }) });
  const { bootstrap, supervisor } = composeSupervisor({ key: options.supervisorKey, channel, now: options.now,
    id: options.id, timeoutMs: SUPERVISOR_COMMAND_TIMEOUT_MS,
    sources: { ...options.sources, dependencies: receipt => cache.materialize(receipt) } });
  const cache = createDependencyCache({ ...options.cache, cleanInstall: gatedInstall(heavy, supervisor.cleanInstall),
    fetch: fetchLockedTarball, storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) });
  const admission = createFairAdmission({ capacity: options.admission.capacity ?? LIVE_NODE_CAPACITY,
    waiterTtlMs: options.admission.waiterTtlMs, now: options.now, holders: () => store.active() });
  return createLiveController({ ...options, cache, store, admission, heavy,
    pods: createBuilderPods(options.kubernetes, bootstrap, options.placement),
    worker: createLiveWorker(supervisor, options.placement) });
}
/** M3-B builder service: the live controller composed with the SG4b handoff publication, the Postgres job ledger,
 * the remote host live state (D0: drafts, session invitation state and package fences pushed by the host) and the host API
 * (builds and live). The sealed candidate holder is both the supervisor sink and the SG4b export.
 * Nothing listens or runs until the host composition mounts `api` and supplies `schedule`. */
export function createBuilderService(options: Omit<Parameters<typeof createArtifactLiveService>[0],
  'publication' | 'sources' | 'drafts' | 'invitations' | 'jobBinding'> & {
  sources: Pick<SupervisorSources, 'source'>;
  host: RemoteHost; signingKey(): SigningKey; hostKeys: KeyResolver;
  /** `hostAuthenticator(parseBuilderHostBindings(...))` over the S2S guard of the builder mount. */
  authenticate(c: Context): HostIdentity | null; schedule(work: () => Promise<void>): void;
  /** Longest wait of one host reconcile before it answers `ready: false` (the revive keeps running). */
  liveWaitMs: number;
  /** Host git bindings (forge-lease-reader contract §1), validated and recorded before anything is scheduled. */
  forgeBindings: Pick<ForgeBindings, 'admit' | 'validate'>;
}) {
  const jobs = createBuildJobs(createPostgresBuildJobStore(options.pool), options.now, options.id,
    runStaleMs(options.heavy.maxWaitMs));
  const candidates = createCandidateStore();
  const publication = createHandoffPublication({ host: options.host, candidates, outcomes: jobs,
    signingKey: options.signingKey, hostKeys: options.hostKeys, now: options.now });
  const rows = createPostgresRemoteLiveRows(options.pool);
  const remote = createRemoteLive(rows); const drafts = createRemoteDrafts(rows);
  const controller = createArtifactLiveService({ ...options, publication, jobBinding: jobForgeBinding(jobs, options.forgeBindings), drafts: drafts.drafts, invitations: remote.invitations,
    sources: { ...options.sources, draft: drafts.draft, candidate: input => candidates.candidate(input) } });
  // A build carries no generation (R1): its validated binding is stored with the job, and the build-only run records it
  // at the HostJob generation right after resolving the job, never at the host's last reconcile.
  const builds = createHostBuildApi({ authenticate: options.authenticate, jobs, schedule: options.schedule,
    validate: options.forgeBindings.validate,
    build: async (key, jobId) => { await controller.buildOnly(key, jobId); } });
  const live = createHostLiveApi({ authenticate: options.authenticate, controller, store: createPostgresLiveStore(options.pool),
    remote, drafts, waitMs: options.liveWaitMs, bind: options.forgeBindings.admit });
  const api = new Hono<HostBuildEnv>().route('/', builds).route('/', live);
  return { controller, api, jobs, remote, drafts };
}
