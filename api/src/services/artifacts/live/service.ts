import type { Pool } from 'pg';
import type { LivePorts } from './ports';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresBuildJobStore, createPostgresLiveStore } from './postgres';
import { createPostgresHeavyGate } from './heavy';
import { createFairAdmission } from './admission';
import { createBuilderPods } from './pods';
import { createInClusterKubernetes } from './kubernetes';
import { createLiveWorker, type QualifiedSupervisor } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';
import type { BuilderPlacement } from './placement';
import type { KeyResolver, SigningKey } from '@sentropic/artifacts/live-host';
import { createHandoffPublication, type CandidateExport, type RemoteHost } from './handoff-publication';
import { createBuildJobs } from './build-jobs';
import { createHostBuildApi, type HostIdentity } from './host-build-api';

/** API composition: runs as sentropic-app; no listeners, background jobs or production activation here.
 * AL-T supplies authenticated owner operations; AL-D supplies the encrypted draft port;
 * SG4 supplies transactional publication; qualified GB4 supplies bootstrap/supervisor transport.
 * `placement` comes from per-environment configuration (`builderPlacement(process.env)`), never a constant.
 */
export function createArtifactLiveService(options: Pick<LivePorts,
  'binding' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'
  | 'invitations'> & {
    pool: Pool; bootstrap: string; supervisor: QualifiedSupervisor; cacheBlobs: PrivateCacheBlobs; placement: BuilderPlacement;
    /** Builder node (the r3.5 d2-4 pool) and the longest wait for its heavy-phase slot. */
    heavyGate: { node: string; maxWaitMs: number };
    /** Live pod slots of this environment, from per-environment configuration (preprod plus prod at most the node's 4). */
    admission: { capacity: number; waiterTtlMs: number };
    cache: Pick<CachePorts, 'signingKey' | 'evidence' | 'cleanInstall'>;
  }) {
  const cache = createDependencyCache({ ...options.cache, fetch: fetchLockedTarball,
    storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) });
  const store = createPostgresLiveStore(options.pool);
  const admission = createFairAdmission({ ...options.admission, now: options.now, holders: () => store.active() });
  return createLiveController({ ...options, cache, store, admission,
    heavy: createPostgresHeavyGate(options.pool, options.heavyGate),
    pods: createBuilderPods(createInClusterKubernetes(options.placement), options.bootstrap, options.placement),
    worker: createLiveWorker(options.supervisor, options.placement) });
}
/** M3-B builder service: the live controller composed with the SG4b handoff publication, the Postgres job ledger and
 * the host build API. Nothing listens or runs until the host composition mounts `api` and supplies `schedule`. */
export function createBuilderService(options: Omit<Parameters<typeof createArtifactLiveService>[0], 'publication'> & {
  host: RemoteHost; candidates: CandidateExport; signingKey(): SigningKey; hostKeys: KeyResolver;
  authenticate(request: Request): Promise<HostIdentity | null>; schedule(work: () => Promise<void>): void;
}) {
  const jobs = createBuildJobs(createPostgresBuildJobStore(options.pool), options.now, options.id);
  const publication = createHandoffPublication({ host: options.host, candidates: options.candidates, outcomes: jobs,
    signingKey: options.signingKey, hostKeys: options.hostKeys, now: options.now });
  const controller = createArtifactLiveService({ ...options, publication });
  const api = createHostBuildApi({ authenticate: options.authenticate, jobs, schedule: options.schedule,
    build: async (key, jobId) => { await controller.buildOnly(key, jobId); } });
  return { controller, api, jobs };
}
