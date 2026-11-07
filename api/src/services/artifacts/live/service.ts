import type { Pool } from 'pg';
import { createHeavyPhaseQueue, type HeavyPhaseBudget } from '@sentropic/cluster-mesh';
import type { LivePorts } from './ports';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresLiveStore } from './postgres';
import { createPostgresHeavyQueueStore, createQueuedHeavyGate, gatedInstall, liveHolds } from './heavy';
import { createFairAdmission } from './admission';
import { createBuilderPods } from './pods';
import { createInClusterKubernetes } from './kubernetes';
import { createLiveWorker, type QualifiedSupervisor } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';

/** Live pods admitted on one d2-4 node (owner decision 07/11); memory admission is the heavy-phase queue's. */
export const LIVE_NODE_CAPACITY = 4;
/** API composition: runs as sentropic-app; no listeners, background jobs or production activation here.
 * AL-T supplies authenticated owner operations; AL-D supplies the encrypted draft port;
 * SG4 supplies transactional publication; qualified GB4 supplies bootstrap/supervisor transport.
 */
export function createArtifactLiveService(options: Pick<LivePorts,
  'binding' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'
  | 'invitations'> & {
    pool: Pool; bootstrap: string; supervisor: QualifiedSupervisor; cacheBlobs: PrivateCacheBlobs;
    /** Builder node (one d2-4), its memory budget for the cluster-mesh heavy-phase queue (1706 MiB, provisional phase
     * costs, measured pod base) and the longest interactive wait; tickets renew at a third of the entry TTL. */
    heavy: { node: string; maxWaitMs: number; pollMs: number; budget: HeavyPhaseBudget };
    /** Live pod slots of this environment from per-environment configuration; the owner decision is 4 on one d2-4. */
    admission: { capacity?: number; waiterTtlMs: number };
    cache: Pick<CachePorts, 'signingKey' | 'evidence' | 'cleanInstall'>;
  }) {
  const store = createPostgresLiveStore(options.pool);
  const { node, maxWaitMs, pollMs, budget } = options.heavy;
  const heavy = createQueuedHeavyGate({ node, maxWaitMs, pollMs, renewMs: budget.entryTtlMs / 3, holds: () => liveHolds(store),
    queue: createHeavyPhaseQueue({ store: createPostgresHeavyQueueStore(options.pool), budget, now: options.now }) });
  const cache = createDependencyCache({ ...options.cache, cleanInstall: gatedInstall(heavy, options.cache.cleanInstall),
    fetch: fetchLockedTarball, storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) });
  const admission = createFairAdmission({ capacity: options.admission.capacity ?? LIVE_NODE_CAPACITY,
    waiterTtlMs: options.admission.waiterTtlMs, now: options.now, holders: () => store.active() });
  return createLiveController({ ...options, cache, store, admission, heavy,
    pods: createBuilderPods(createInClusterKubernetes(), options.bootstrap), worker: createLiveWorker(options.supervisor) });
}
