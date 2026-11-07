import type { Context } from 'hono';
import type { Pool } from 'pg';
import { createHeavyPhaseQueue, type HeavyPhaseBudget } from '@sentropic/cluster-mesh';
import type { LivePorts } from './ports';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresBuildJobStore, createPostgresLiveStore } from './postgres';
import { createPostgresHeavyQueueStore, createQueuedHeavyGate, gatedInstall, liveHolds } from './heavy';
import { createFairAdmission } from './admission';
import { createBuilderPods } from './pods';
import { createInClusterKubernetes } from './kubernetes';
import { createLiveWorker } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';
import type { BuilderPlacement } from './placement';
import type { KeyResolver, SigningKey } from '@sentropic/artifacts/live-host';
import { createHandoffPublication, type RemoteHost } from './handoff-publication';
import { createCandidateStore } from './candidate-store';
import { composeSupervisor } from './supervisor-composition';
import type { SupervisorSources } from './supervisor';
import type { SupervisorChannel } from './supervisor-channel';
import { createBuildJobs, runStaleMs } from './build-jobs';
import { createHostBuildApi, type HostIdentity } from './host-build-api';

/** Live pods admitted on one d2-4 node (owner decision 07/11); memory admission is the heavy-phase queue's. */
export const LIVE_NODE_CAPACITY = 4;
/** API composition: runs as sentropic-app; no listeners, background jobs or production activation here.
 * AL-T supplies authenticated owner operations; AL-D supplies the encrypted draft port;
 * SG4 supplies transactional publication; W9 supplies the relay channel to the pod bootstrap (qualified under GB4).
 * `supervisorKey(process.env)` signs every frame and is the only key the composed bootstrap trusts (FIX5).
 * `placement` comes from per-environment configuration (`builderPlacement(process.env)`), never a constant.
 */
export function createArtifactLiveService(options: Pick<LivePorts,
  'binding' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'
  | 'invitations'> & {
    pool: Pool; cacheBlobs: PrivateCacheBlobs; placement: BuilderPlacement;
    supervisorKey: SigningKey; channel: SupervisorChannel;
    /** Staged source, AL-D draft and candidate sink; the dependency stream is this service's cache. */
    sources: Omit<SupervisorSources, 'dependencies'>;
    /** Builder node (one d2-4), its memory budget for the cluster-mesh heavy-phase queue (1706 MiB, provisional phase
     * costs, measured pod base) and the longest interactive wait; tickets renew at a third of the entry TTL. */
    heavy: { node: string; maxWaitMs: number; pollMs: number; budget: HeavyPhaseBudget };
    /** Live pod slots of this environment from per-environment configuration; the owner decision is 4 on one d2-4. */
    admission: { capacity?: number; waiterTtlMs: number };
    cache: Pick<CachePorts, 'signingKey'>;
  }) {
  const store = createPostgresLiveStore(options.pool);
  const { node, maxWaitMs, pollMs, budget } = options.heavy;
  const heavy = createQueuedHeavyGate({ node, maxWaitMs, pollMs, renewMs: budget.entryTtlMs / 3, holds: () => liveHolds(store),
    queue: createHeavyPhaseQueue({ store: createPostgresHeavyQueueStore(options.pool), budget, now: options.now }) });
  const { bootstrap, supervisor } = composeSupervisor({ key: options.supervisorKey, channel: options.channel, now: options.now,
    id: options.id, sources: { ...options.sources, dependencies: receipt => cache.materialize(receipt) } });
  const cache = createDependencyCache({ ...options.cache, cleanInstall: gatedInstall(heavy, supervisor.cleanInstall),
    fetch: fetchLockedTarball, storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) });
  const admission = createFairAdmission({ capacity: options.admission.capacity ?? LIVE_NODE_CAPACITY,
    waiterTtlMs: options.admission.waiterTtlMs, now: options.now, holders: () => store.active() });
  return createLiveController({ ...options, cache, store, admission, heavy,
    pods: createBuilderPods(createInClusterKubernetes(options.placement), bootstrap, options.placement),
    worker: createLiveWorker(supervisor, options.placement) });
}
/** M3-B builder service: the live controller composed with the SG4b handoff publication, the Postgres job ledger and
 * the host build API. The sealed candidate holder is both the supervisor sink and the SG4b export.
 * Nothing listens or runs until the host composition mounts `api` and supplies `schedule`. */
export function createBuilderService(options: Omit<Parameters<typeof createArtifactLiveService>[0], 'publication' | 'sources'> & {
  sources: Pick<SupervisorSources, 'source' | 'draft'>;
  host: RemoteHost; signingKey(): SigningKey; hostKeys: KeyResolver;
  /** `hostAuthenticator(parseBuilderHostBindings(...))` over the S2S guard of the builder mount. */
  authenticate(c: Context): HostIdentity | null; schedule(work: () => Promise<void>): void;
}) {
  const jobs = createBuildJobs(createPostgresBuildJobStore(options.pool), options.now, options.id,
    runStaleMs(options.heavy.maxWaitMs));
  const candidates = createCandidateStore();
  const publication = createHandoffPublication({ host: options.host, candidates, outcomes: jobs,
    signingKey: options.signingKey, hostKeys: options.hostKeys, now: options.now });
  const controller = createArtifactLiveService({ ...options, publication,
    sources: { ...options.sources, candidate: input => candidates.candidate(input) } });
  const api = createHostBuildApi({ authenticate: options.authenticate, jobs, schedule: options.schedule,
    build: async (key, jobId) => { await controller.buildOnly(key, jobId); } });
  return { controller, api, jobs };
}
