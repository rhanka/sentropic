import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Context } from 'hono';
import { createBuilderService } from './service';
import { builderPlacement, type BuilderPlacement } from './placement';
import { BUILDER_KEY_ENV, builderKeys, SUPERVISOR_KEY_ENV, supervisorKey } from './builder-keys';
import { SUPERVISOR_RELAY_URL_ENV, supervisorRelayUrl } from './supervisor-relay';
import { BUILDER_REMOTE_HOST_ENV, builderRemoteHost } from './remote-host';
import { controllerFenceKey, createLiveFenceRoutes, LIVE_CONTROLLER_KEY_ENV, LIVE_EDGE_URL_ENV, liveEdgeUrl } from './live-fence';
import { remoteHostForge } from './forge';
import { createForgeBindings, forgeConfig, type ForgeLeaseHost } from './forge-binding';
import { createLeaseForgeReads, runtimeGeneration } from './forge-lease';
import { createPostgresLiveStore, createPostgresRemoteLiveRows } from './postgres';
import { parseBuilderHostBindings } from './builder-mount';
import { createLiveScheduler } from './scheduler';
import { readBuilderCacheStorage, type BuilderCacheStorage, type PrivateCacheBlobs } from './cache-storage';
import { readInstallBudget } from './deadline';
import { LiveError } from './records';
import type { HostIdentity } from './host-build-api';
import { readWorkerSizing, type KubernetesCore } from './pods';
import { installEnvironment, readInstallHeapMb } from './recipes';
import type { LivePorts } from './ports';

type Env = Readonly<Record<string, string | undefined>>;
/** Flag of the composed builder service (cm/api); anything but `1` keeps the 503 builder_unavailable mount. */
export const BUILDER_ENABLED_ENV = 'ARTIFACT_BUILDER_ENABLED';
/** 32 random bytes, base64url (owner sentropic, environment secret): the dependency cache receipt HMAC key. */
export const CACHE_SIGNING_KEY_ENV = 'ARTIFACT_DEPENDENCY_CACHE_SIGNING_KEY';
/** Builder node of the heavy-phase queue (one d2-4 per environment; preprod `d2-4-preprod`). */
export const BUILDER_NODE_ENV = 'ARTIFACT_BUILDER_NODE';
export const BUILDER_HOST_BINDINGS_ENV = 'ARTIFACT_BUILDER_HOST_BINDINGS_JSON';
/** Lease frames and reconciles of every non-DORMANT runtime (A-LIVE Amendment 1 §3). */
export const SCHEDULER_INTERVAL_MS = 30_000;
/** s-archi builder-composition contract (08/11, resized 10/11): heavy budget of one logical d2-4 node, 1641 MiB, 19 MiB measured pod base (one heavy phase at a time, conservative); 2 pods, live or build (requests.memory quota 3Gi: 2 x 1536Mi). */
export const PRODUCT_HEAVY = Object.freeze({ maxWaitMs: 600_000, pollMs: 1_000, maxPods: 2,
  budget: Object.freeze({ budgetMiB: 1641, podBaseMiB: 19, entryTtlMs: 90_000,
    costs: Object.freeze({ install: 1370, prebundle: 980, dev: 390, build: 1370 }) }) });
/** Two admission slots, like the two builder pod slots: a 3rd admitted session would only wait for a pod
 * slot up to 600 s before a `queued` failure. */
export const PRODUCT_ADMISSION = Object.freeze({ capacity: 2, waiterTtlMs: 60_000 });
export const PRODUCT_LIVE_WAIT_MS = 25_000;
const LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/** Boot refusal: names the variable, never its value. */
class BootRefusal extends Error {
  constructor(readonly variable: string) { super(`Artifact builder refused to start: ${variable} is missing or invalid`); }
}
function refuse(name: string): never {
  throw new BootRefusal(name);
}
function read<T>(name: string, parse: () => T): T {
  try { return parse(); } catch { return refuse(name); }
}
function cacheKey(env: Env): Uint8Array {
  const value = env[CACHE_SIGNING_KEY_ENV]?.trim() ?? '';
  const key = Buffer.from(value, 'base64url');
  return /^[A-Za-z0-9_-]+$/.test(value) && key.length >= 32 ? key : refuse(CACHE_SIGNING_KEY_ENV);
}

export interface ProductBuilderDeps {
  /** Dependency-cache blobs of the builder's own private S3 storage (F1); receives the validated settings. */
  cacheBlobs(settings: BuilderCacheStorage): PrivateCacheBlobs;
  pool: Pool; authenticate(c: Context): HostIdentity | null;
  /** In-cluster client of the builder namespace (`createInClusterKubernetes`); a fake in tests. */
  kubernetes(placement: BuilderPlacement): KubernetesCore;
  /** The enabled SG0-app host (`createProductGitHubAppLease`): targets, lease and invalidation bus; null when disabled,
   * then every forge read refuses `forge_unconfigured`. */
  gitHubApp: ForgeLeaseHost | null; log(event: string, error: unknown): void;
  now?: () => number; id?: () => string; fetch?: typeof fetch;
}

/**
 * Product composition of the M3-B builder service (A-LIVE §10, GB4-P). Null unless `ARTIFACT_BUILDER_ENABLED=1`; with
 * the flag on, any missing or invalid value refuses to compose GRACEFULLY (F2, s-archi builder-composition review):
 * the process stays up serving everything else, the mount keeps answering 503 `builder_unavailable`, no scheduler
 * starts, and the refusal is logged as `artifact_builder_refused` naming the variable, never its value. `start` runs
 * the live scheduler once per process.
 */
export function createProductBuilder(env: Env, deps: ProductBuilderDeps) {
  if (env[BUILDER_ENABLED_ENV] !== '1') return null;
  try {
    return composeProductBuilder(env, deps);
  } catch (error) {
    // A misconfigured builder never takes the API (and the authorization server) down with it.
    if (!(error instanceof BootRefusal)) throw error;
    deps.log('artifact_builder_refused', new LiveError('builder_unavailable', error.variable));
    return null;
  }
}

function composeProductBuilder(env: Env, deps: ProductBuilderDeps) {
  const now = deps.now ?? Date.now; const id = deps.id ?? randomUUID;
  const placement = read(LABEL.test(env.ARTIFACT_BUILDER_NAMESPACE ?? '') ? 'ARTIFACT_BUILDER_SERVICE_DOMAIN'
    : 'ARTIFACT_BUILDER_NAMESPACE', () => builderPlacement(env));
  const signer = read(SUPERVISOR_KEY_ENV, () => supervisorKey(env));
  const relayUrl = read(SUPERVISOR_RELAY_URL_ENV, () => supervisorRelayUrl(env));
  read(BUILDER_KEY_ENV.signing, () => supervisorKey({ [SUPERVISOR_KEY_ENV]: env[BUILDER_KEY_ENV.signing] }));
  const keys = read(BUILDER_KEY_ENV.hostReceipts, () => builderKeys(env));
  const host = read(BUILDER_REMOTE_HOST_ENV, () => builderRemoteHost(env, { signingKey: keys.signingKey, now, fetch: deps.fetch }));
  const fenceKey = read(LIVE_CONTROLLER_KEY_ENV, () => controllerFenceKey(env));
  const edgeUrl = read(LIVE_EDGE_URL_ENV, () => liveEdgeUrl(env));
  const signingKey = cacheKey(env);
  const node = env[BUILDER_NODE_ENV]?.trim() ?? '';
  if (!LABEL.test(node)) refuse(BUILDER_NODE_ENV);
  if (parseBuilderHostBindings(env[BUILDER_HOST_BINDINGS_ENV]).size === 0) refuse(BUILDER_HOST_BINDINGS_ENV);
  // F1 (option (a)): the dependency cache lives in its OWN private S3 storage, never the sentropic artifacts
  // host storage, so APP_ARTIFACT_HOST_ENABLED (the MCP host) is not part of the builder configuration.
  const cacheStorage = readBuilderCacheStorage(env);
  if (typeof cacheStorage === 'string') refuse(cacheStorage);

  let service: ReturnType<typeof createBuilderService>;
  // Forge reads through the in-process SG0-app lease at the binding recorded for the controller's runtime generation.
  const config = forgeConfig(env, deps.gitHubApp);
  const forgeBindings = createForgeBindings(createPostgresRemoteLiveRows(deps.pool), config);
  const reads = createLeaseForgeReads({ config, bindings: forgeBindings, fetch: deps.fetch, now, id,
    generation: runtimeGeneration(createPostgresLiveStore(deps.pool), key => service.remote.session(key)) });
  // D0 binding view: generation and owner of the host's last reconcile; publication stays explicit (R4, no autoPublish).
  const binding: LivePorts['binding'] = async key => {
    const { generation, ownerId } = await service.remote.session(key);
    return { generation, ownerId, headSha: await reads.head(key), healthy: true, autoPublish: false,
      automaticAuthorized: false, releaseId: null, releaseCommit: null, initialUnpublishedBranchEligible: false };
  };
  const schedule = (work: () => Promise<void>) => { void work().catch(error => deps.log('artifact_builder_job_failed', error)); };
  service = createBuilderService({ pool: deps.pool, cacheBlobs: deps.cacheBlobs(cacheStorage), placement, supervisorKey: signer,
    relayUrl, kubernetes: deps.kubernetes(placement), host, signingKey: keys.signingKey, hostKeys: keys.hostKeys,
    authenticate: deps.authenticate, schedule, liveWaitMs: PRODUCT_LIVE_WAIT_MS, now, id, binding,
    installBudget: readInstallBudget(env), sizing: readWorkerSizing(env),
    installEnv: installEnvironment(readInstallHeapMb(env)),
    forge: remoteHostForge(reads), sources: { source: reads.source }, forgeBindings,
    routes: createLiveFenceRoutes({ baseUrl: edgeUrl, key: fenceKey, now, fetch: deps.fetch }),
    heavy: { node, ...PRODUCT_HEAVY }, admission: PRODUCT_ADMISSION, cache: { signingKey: () => signingKey } });
  let running: { stop(): void } | null = null;
  return {
    api: service.api, controller: service.controller,
    /** Idempotent: one scheduler per process, renewing leases and reconciling every 30 s; `stop` clears it. */
    start() {
      running ??= createLiveScheduler({ controller: service.controller, intervalMs: SCHEDULER_INTERVAL_MS,
        onError: (_key, error) => deps.log('artifact_live_tick_failed', error) }).start();
      return running;
    },
  };
}
export type ProductBuilder = NonNullable<ReturnType<typeof createProductBuilder>>;
