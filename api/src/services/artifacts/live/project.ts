import type { LivePorts } from './ports';
import { assertFence, conflict, LiveError, type LiveKey } from './records';
import { currentBinding, failed, observeHead, transition } from './transitions';
import { withinPhase } from './deadline';
import { revive } from './revive';

/** Called after AL-D commits an admitted revision/result. Replays cannot reproject an older draft. */
export async function projectRevision(ports: LivePorts, key: LiveKey, revision: string) {
  const binding = await currentBinding(ports, key);
  const draft = await ports.drafts.current(key, binding.generation);
  if (draft.revision !== revision) throw new LiveError('git_live_revision_moved');
  const stored = await ports.store.read(key);
  if (!stored || stored.runtime.phase === 'DORMANT') return revive(ports, key);
  let runtime = stored.runtime;
  if (runtime.generation !== binding.generation || draft.generation !== binding.generation) conflict('stale_fence');
  const head = await observeHead(ports, key, runtime);
  if (head !== draft.baseHeadSha) throw new LiveError('git_live_draft_conflict');
  runtime = await ports.store.transaction(key, async unit => {
    assertFence(unit.state, runtime);
    const current = unit.state.runtime;
    if (current.phase !== 'LIVE') conflict('transition_busy');
    if (current.sourceRevision === revision && current.appliedRevision === revision) return structuredClone(current);
    current.phase = 'REVIVING'; current.routeEpoch++; current.appliedRevision = null;
    current.sourceRevision = revision; current.baseHeadSha = draft.baseHeadSha; current.liveTreeSha = draft.treeSha;
    current.lastAccessAt = ports.now(); return structuredClone(current);
  });
  if (runtime.phase === 'LIVE') return runtime;
  try {
    await ports.routes.revoke(key, runtime);
    await ports.drafts.checkpoint(key, draft);
    await withinPhase(ports.worker.restore(runtime, draft));
    const ready = await withinPhase(ports.worker.live(runtime));
    await currentBinding(ports, key, runtime.generation);
    if ((await ports.drafts.current(key, runtime.generation)).revision !== revision) throw new LiveError('git_live_revision_moved');
    if (await ports.forge.head(key) !== head) throw new LiveError('git_head_moved');
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'REVIVING' || ready.revision !== revision || ready.routeEpoch !== state.runtime.routeEpoch) conflict('stale_fence');
      state.runtime.phase = 'LIVE'; state.runtime.appliedRevision = revision;
    });
    await ports.routes.ready(key, runtime); return runtime;
  } catch (error) { await failed(ports, key, runtime, error); throw error; }
}
