import type { LivePorts } from './ports';
import { conflict, LiveError, type LiveKey, type LiveRuntime } from './records';
import { checkpoint, currentBinding, observeHead, transition } from './transitions';

/** Used by cold revive and wake after the older build process tree has terminated. */
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
  runtime = await transition(ports, key, runtime, state => { state.runtime.podUid = pod.uid; });
  const source = await ports.forge.snapshot(key, head);
  if (source.headSha !== head) throw new LiveError('git_head_moved');
  const cache = await ports.cache.acquire(source);
  await ports.worker.clean(runtime);
  await ports.worker.prepare(runtime, source, cache);
  await ports.worker.restore(runtime, draft);
  const ready = await ports.worker.live(runtime);
  await currentBinding(ports, key, runtime.generation);
  if (await ports.forge.head(key) !== head) throw new LiveError('git_head_moved');
  const live = await transition(ports, key, runtime, state => {
    if (state.runtime.phase !== 'REVIVING' || ready.revision !== state.runtime.sourceRevision
      || ready.routeEpoch !== state.runtime.routeEpoch || ports.now() >= state.runtime.maximumLifetimeAt) conflict('stale_fence');
    state.runtime.phase = 'LIVE'; state.runtime.appliedRevision = ready.revision; state.runtime.pendingWake = false;
  });
  await ports.routes.ready(key, live);
  return live;
}
