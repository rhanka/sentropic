import type { LivePorts } from './ports';
import { conflict, LiveError, type LiveKey, type LiveRuntime } from './records';
import { enrichPodLoss, isPodCause } from './pods';
import { ensureResponsivePod, notePodLoss } from './pod-probe';
import { checkpoint, currentBinding, currentRuntime, observeHead, transition } from './transitions';
import { cacheKeyOf, requireUserCache } from './cache';
import { eventsContext } from './phase-events';
import { runPhase, withinPhase } from './deadline';
import { releaseIfDormant } from './admission';
import type { PoolClaim } from './pool';

/** Cold revive, crash restore or wake: adopts only a responsive pod, and reports a lost pod with its Kubernetes
 * cause. Callers (`revive`, `wake`) tear the runtime down on the enriched error. */
export async function prepareLive(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  try {
    return await preparePod(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') throw error;
    if (error instanceof LiveError && error.code === 'cache_not_prewarmed') {
      // §7.1.4: an unsealed lockfile never leaves a half-started runtime behind. The REVIVING row written by
      // `revive`/`wake` rolls back to DORMANT with the typed detail (no pod was touched: the sealed lookup
      // runs before the first pod slot), the admission slot is freed, and the typed error reaches the MCP
      // caller inside the 5 s lookup bound.
      const current = await currentRuntime(ports, key, runtime);
      await transition(ports, key, current, state => {
        if (state.runtime.phase !== 'REVIVING' || state.runtime.sessionId !== current.sessionId) conflict('stale_fence');
        state.runtime.phase = 'DORMANT'; state.runtime.podUid = null; state.runtime.appliedRevision = null;
        state.runtime.attempt = null;
        state.runtime.stateDetail = error.reason ? `${error.code}:${error.reason}` : error.code;
      }).catch(() => undefined);
      await releaseIfDormant(ports, key).catch(() => undefined);
      throw error;
    }
    const loss = await enrichPodLoss(ports.pods, key, runtime, error);
    if (loss instanceof LiveError && isPodCause(loss)) await notePodLoss(key, loss);
    throw loss;
  }
}
/** Used by cold revive, crash restore and wake after the older build process tree has terminated. Each heavy phase
 * waits its own turn in the node queue, so a pre-bundle never overlaps another pre-bundle or a build. */
async function preparePod(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  const head = await observeHead(ports, key, runtime);
  let draft = await checkpoint(ports, key, runtime);
  if (draft.baseHeadSha !== head) {
    if (draft.dirty) throw new LiveError('git_live_draft_conflict');
    draft = await ports.drafts.advanceClean(key, draft, head);
  }
  runtime = await transition(ports, key, runtime, state => {
    if (state.runtime.phase !== 'REVIVING') conflict('stale_fence');
    state.runtime.sourceRevision = draft.revision; state.runtime.baseHeadSha = draft.baseHeadSha;
    state.runtime.liveTreeSha = draft.treeSha;
  });
  // Sealed-cache pre-admission (§7.1.4): the snapshot and the lookup run before the first pod slot, so an
  // unsealed lockfile rejects without creating a pod. The rollback in `prepareLive` returns the row to DORMANT.
  const events = eventsContext(ports, runtime.sessionId, 'live_start');
  const source = await ports.forge.snapshot(key, head);
  if (source.headSha !== head) throw new LiveError('git_head_moved');
  const cache = await runPhase(key, 'install', () => requireUserCache(ports.cache, source, runtime),
    events ? { events } : {});
  const cacheKey = cacheKeyOf(source.cacheIdentity);
  // Warm claim (§7.3.2): a `warm` pod skips pod creation, dependency extraction and prebundle. A pool outage
  // degrades to Cold-known (the miss path); the empty pool surfaces as an alert on `/v1/pool` (L6).
  let claimed: PoolClaim | undefined;
  if (ports.pool) {
    try { claimed = await ports.pool.claimForLive(key.storageScopeId, cacheKey); }
    catch { claimed = undefined; }
  }
  if (claimed) {
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'REVIVING') conflict('stale_fence');
      state.runtime.sourceRevision = draft.revision; state.runtime.baseHeadSha = draft.baseHeadSha;
      state.runtime.liveTreeSha = draft.treeSha;
      state.runtime.podUid = claimed.podUid; state.runtime.podName = claimed.podName;
      state.runtime.poolEpoch = claimed.poolEpoch; state.runtime.poolBound = 1;
    });
    const claimStarted = ports.now();
    await ports.pods.adoptClaimed(key, runtime);
    await ports.worker.claim(runtime);
    runtime = await transition(ports, key, runtime, state => { state.runtime.cacheKey = cacheKey; });
    await events?.sink.record({ invocationId: events.invocationId, artifactId: key.artifactId,
      storageScopeId: key.storageScopeId, operation: 'live_start', phase: 'pod_ready', pool: 'warm-hit',
      at: claimStarted, ms: ports.now() - claimStarted, outcome: 'ok' });
    if (claimed.baseHeadSha === draft.baseHeadSha) {
      await ports.worker.restore(runtime, draft);
    } else {
      // The binding head moved past the warm base: restage fully (prepare re-extracts deps), then restore.
      await runPhase(key, 'prepare', () => ports.worker.prepare(runtime, source, cache), events ? { events } : {});
      await ports.worker.restore(runtime, draft);
      await ports.heavy.run(runtime.podName, 'prebundle', () => runPhase(key, 'prebundle',
        () => withinPhase(ports.worker.prebundle(runtime)), events ? { events } : {}));
    }
  } else {
    const pod = await ports.heavy.pod(runtime.podName, () => ensureResponsivePod(ports, key, runtime));
    runtime = await transition(ports, key, runtime, state => {
      state.runtime.podUid = pod.uid;
      if (pod.replaced) state.runtime.routeEpoch++;
    });
    await ports.worker.clean(runtime);
    await runPhase(key, 'prepare', () => ports.worker.prepare(runtime, source, cache), events ? { events } : {});
    await ports.worker.restore(runtime, draft);
    await ports.heavy.run(runtime.podName, 'prebundle', () => runPhase(key, 'prebundle',
      () => withinPhase(ports.worker.prebundle(runtime)), events ? { events } : {}));
    runtime = await transition(ports, key, runtime, state => { state.runtime.cacheKey = cacheKey; });
  }
  const ready = await ports.heavy.run(runtime.podName, 'dev', () => runPhase(key, 'live',
    () => withinPhase(ports.worker.live(runtime)), events ? { events } : {}), { live: true });
  await currentBinding(ports, key, runtime.generation);
  if (await ports.forge.head(key) !== head) throw new LiveError('git_head_moved');
  const live = await transition(ports, key, runtime, state => {
    if (state.runtime.phase !== 'REVIVING' || ready.revision !== state.runtime.sourceRevision
      || ready.routeEpoch !== state.runtime.routeEpoch) conflict('stale_fence');
    state.runtime.phase = 'LIVE'; state.runtime.appliedRevision = ready.revision; state.runtime.pendingWake = false;
  });
  await ports.routes.ready(key, live);
  return live;
}
