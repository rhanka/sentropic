import type { Pool } from 'pg';
import type { LivePorts } from './ports';
import type { CachePorts } from './cache';
import type { PrivateCacheBlobs } from './cache-storage';
import { createPostgresCacheStorage } from './cache-storage';
import { createDependencyCache } from './cache';
import { createPostgresLiveStore } from './postgres';
import { createBuilderPods } from './pods';
import { createInClusterKubernetes } from './kubernetes';
import { createLiveWorker, type QualifiedSupervisor } from './worker';
import { createLiveController } from './controller';
import { fetchLockedTarball } from './npm-relay';

/** API composition: runs as sentropic-app; no listeners, background jobs or production activation here.
 * AL-T supplies authenticated owner operations; AL-D supplies the encrypted draft port;
 * SG4 supplies transactional publication; qualified GB4 supplies bootstrap/supervisor transport.
 */
export function createArtifactLiveService(options: Pick<LivePorts,
  'binding' | 'forge' | 'drafts' | 'routes' | 'publication' | 'now' | 'id'> & {
    pool: Pool; bootstrap: string; supervisor: QualifiedSupervisor; cacheBlobs: PrivateCacheBlobs;
    cache: Pick<CachePorts, 'signingKey' | 'evidence' | 'cleanInstall'>;
  }) {
  const cache = createDependencyCache({ ...options.cache, fetch: fetchLockedTarball,
    storage: createPostgresCacheStorage(options.pool, options.cacheBlobs) });
  return createLiveController({ ...options, cache, store: createPostgresLiveStore(options.pool),
    pods: createBuilderPods(createInClusterKubernetes(), options.bootstrap), worker: createLiveWorker(options.supervisor) });
}
