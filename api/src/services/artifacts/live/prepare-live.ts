import type { LivePorts } from './ports';
import { conflict, LiveError, type LiveKey, type LiveRuntime } from './records';
import { checkpoint, currentBinding, observeHead, transition } from './transitions';
import { withinPhase } from './deadline';

/** Used by cold revive, crash restore and wake after the older build process tree has terminated. Each heavy phase
 * waits its own turn in the node queue, so a pre-bundle never overlaps another pre-bundle or a build. */
export async function prepareLive(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
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
  const pod = await ports.pods.ensure(key, runtime);
  await ports.heavy.hold(runtime.podName, { pod: true });
  runtime = await transition(ports, key, runtime, state => { state.runtime.podUid = pod.uid; });
  const source = await ports.forge.snapshot(key, head);
  if (source.headSha !== head) throw new LiveError('git_head_moved');
  await ports.worker.clean(runtime);
  const cache = await withinPhase(ports.cache.acquire(source, runtime));
  await ports.worker.prepare(runtime, source, cache);
  await ports.worker.restore(runtime, draft);
  await ports.heavy.run(runtime.podName, 'prebundle', () => withinPhase(ports.worker.prebundle(runtime)));
  const ready = await ports.heavy.run(runtime.podName, 'dev', () => withinPhase(ports.worker.live(runtime)), { live: true });
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
