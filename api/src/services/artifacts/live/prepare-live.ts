import type { LivePorts } from './ports';
import { conflict, LiveError, type LiveKey, type LiveRuntime } from './records';
import { enrichPodLoss, isPodCause } from './pods';
import { ensureResponsivePod, notePodLoss } from './pod-probe';
import { checkpoint, currentBinding, observeHead, transition } from './transitions';
import { requireUserCache } from './cache';
import { runPhase, withinPhase } from './deadline';

/** Cold revive, crash restore or wake: adopts only a responsive pod, and reports a lost pod with its Kubernetes
 * cause. Callers (`revive`, `wake`) tear the runtime down on the enriched error. */
export async function prepareLive(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  try {
    return await preparePod(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') throw error;
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
  const pod = await ports.heavy.pod(runtime.podName, () => ensureResponsivePod(ports, key, runtime));
  runtime = await transition(ports, key, runtime, state => {
    state.runtime.podUid = pod.uid;
    if (pod.replaced) state.runtime.routeEpoch++;
  });
  const source = await ports.forge.snapshot(key, head);
  if (source.headSha !== head) throw new LiveError('git_head_moved');
  await ports.worker.clean(runtime);
  const cache = await runPhase(key, 'install', () => requireUserCache(ports.cache, source, runtime));
  await runPhase(key, 'prepare', () => ports.worker.prepare(runtime, source, cache));
  await ports.worker.restore(runtime, draft);
  await ports.heavy.run(runtime.podName, 'prebundle', () => runPhase(key, 'prebundle',
    () => withinPhase(ports.worker.prebundle(runtime))));
  const ready = await ports.heavy.run(runtime.podName, 'dev', () => runPhase(key, 'live',
    () => withinPhase(ports.worker.live(runtime))), { live: true });
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
