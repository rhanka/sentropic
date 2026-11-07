import type { CacheReceipt } from './cache';
import type { DraftSnapshot, LivePorts, SourceSnapshot } from './ports';
import type { LiveAttempt, LiveRuntime } from './records';
import { artifactEnvironment, BUILD_RECIPE, buildEnvironment, LIVE_RECIPE, liveViteConfig, PREBUNDLE_RECIPE } from './recipes';

/** GB4's bounded trusted transport; repository processes cannot invoke this interface.
 * It enforces monotonic session/lease/route fences and whole-process-tree cancellation.
 * Phase fencing closes existing relay connections, not just future connection admission.
 */
export interface QualifiedSupervisor {
  phase(runtime: LiveRuntime, phase: 'offline' | 'stopped'): Promise<void>;
  terminate(runtime: LiveRuntime): Promise<void>;
  clear(runtime: LiveRuntime, paths: readonly string[]): Promise<void>;
  stage(runtime: LiveRuntime, source: SourceSnapshot): Promise<void>;
  dependencies(runtime: LiveRuntime, cache: CacheReceipt, options: { readOnly: true; verifyHash: true }): Promise<void>;
  overlay(runtime: LiveRuntime, draft: DraftSnapshot): Promise<void>;
  hostFile(runtime: LiveRuntime, path: string, source: string): Promise<void>;
  /** Separate heavy phase, op `prebundle { recipe: 'prebundle' }` (W3). The pod bootstrap writes its frozen
   * LIVE_PREBUNDLE_SCRIPT itself (no hostFile) and runs it to completion; it writes only the emptyDir cacheDir, never the
   * shared dependency cache; `dev` refuses before it. */
  prebundle(runtime: LiveRuntime, command: typeof PREBUNDLE_RECIPE, env: ReturnType<typeof artifactEnvironment>):
    Promise<{ prebundled: true }>;
  dev(runtime: LiveRuntime, command: typeof LIVE_RECIPE, env: ReturnType<typeof artifactEnvironment>):
    Promise<{ revision: string; routeEpoch: number }>;
  build(runtime: LiveRuntime, attempt: LiveAttempt, command: typeof BUILD_RECIPE,
    env: ReturnType<typeof buildEnvironment>): Promise<{ candidateDigest: string }>;
  /** Trusted stable snapshot verifier, outside repository code; links/special files and limit overflow refuse. */
  verify(runtime: LiveRuntime, attempt: LiveAttempt, limits: { files: 255; fileBytes: 16777216; totalBytes: 67108864 }): Promise<void>;
  /** Liveness lease (A-LIVE Amendment 1 §3, W8 port): fenced, side-effect free; the controller sends it at least every
   * 60 s outside DORMANT. */
  renew(runtime: LiveRuntime): Promise<void>;
}
export function createLiveWorker(supervisor: QualifiedSupervisor): LivePorts['worker'] {
  return {
    async quiesce(runtime) { await supervisor.phase(runtime, 'stopped'); await supervisor.terminate(runtime); },
    async clean(runtime) {
      await supervisor.clear(runtime, ['/workspace', '/dependencies', '/tmp']);
    },
    async prepare(runtime, source, cache) {
      await supervisor.clear(runtime, ['/workspace', '/dependencies', '/tmp']);
      await supervisor.stage(runtime, source);
      await supervisor.dependencies(runtime, cache, { readOnly: true, verifyHash: true });
      await supervisor.phase(runtime, 'offline');
    },
    restore: (runtime, draft) => supervisor.overlay(runtime, draft),
    async prebundle(runtime) {
      await supervisor.hostFile(runtime, '/tmp/artifact-vite.config.mjs', liveViteConfig(runtime.sessionId, runtime.podName));
      await supervisor.prebundle(runtime, PREBUNDLE_RECIPE, artifactEnvironment());
    },
    live: runtime => supervisor.dev(runtime, LIVE_RECIPE, artifactEnvironment()),
    async build(runtime, attempt) {
      const candidate = await supervisor.build(runtime, attempt, BUILD_RECIPE, buildEnvironment());
      await supervisor.terminate(runtime);
      return candidate;
    },
    verify: (runtime, attempt) => supervisor.verify(runtime, attempt, { files: 255, fileBytes: 16777216, totalBytes: 67108864 }),
    renew: runtime => supervisor.renew(runtime),
  };
}
