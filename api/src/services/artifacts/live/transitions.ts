import type { LivePorts, LiveBinding } from './ports';
import { assertFence, conflict, LiveError, recordHead, type LiveKey, type LiveRuntime, type LiveState } from './records';

export async function currentBinding(ports: LivePorts, key: LiveKey, generation?: number): Promise<LiveBinding> {
  const binding = await ports.binding(key);
  if (!binding.healthy) throw new LiveError('git_binding_paused');
  if (generation !== undefined && generation !== binding.generation) conflict('stale_fence');
  return binding;
}
export async function observeHead(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  const head = await ports.forge.head(key);
  return ports.store.transaction(key, async unit => {
    assertFence(unit.state, runtime);
    const progress = unit.state.progress;
    if (head !== progress.latestVerifiedHeadSha) {
      if (!await ports.forge.fastForward(key, progress.latestVerifiedHeadSha, head)) throw new LiveError('git_diverged');
      recordHead(progress, head, `head:${head}`);
    }
    return head;
  });
}
export async function transition(ports: LivePorts, key: LiveKey, runtime: LiveRuntime,
  work: (state: LiveState) => void) {
  return ports.store.transaction(key, async unit => {
    assertFence(unit.state, runtime);
    work(unit.state);
    return structuredClone(unit.state.runtime);
  });
}
export async function checkpoint(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  const draft = await ports.drafts.current(key);
  if (draft.generation !== runtime.generation) conflict('stale_fence');
  await ports.drafts.checkpoint(key, draft);
  return draft;
}
/** Always retain the old pod fence until its deletion has been confirmed. */
export async function teardown(ports: LivePorts, key: LiveKey, runtime: LiveRuntime, detail?: string) {
  runtime = await transition(ports, key, runtime, state => {
    state.runtime.routeEpoch++; state.runtime.phase = 'SAVING'; state.runtime.stateDetail = detail;
  });
  await ports.routes.revoke(key, runtime);
  try {
    await ports.worker.quiesce(runtime);
    await checkpoint(ports, key, runtime);
    runtime = await transition(ports, key, runtime, state => { state.runtime.phase = 'DECOMMISSIONING'; });
    await ports.pods.remove(key, runtime);
  } catch (error) {
    await transition(ports, key, runtime, state => { state.runtime.phase = 'RECOVERING'; });
    throw error;
  }
  return transition(ports, key, runtime, state => {
    state.runtime.phase = 'DORMANT'; state.runtime.podUid = null;
    state.runtime.appliedRevision = null; state.runtime.attempt = null;
  });
}
export async function failed(ports: LivePorts, key: LiveKey, runtime: LiveRuntime, error: unknown) {
  const detail = error instanceof LiveError ? error.code : 'builder_unavailable';
  // If checkpoint/deletion cannot be confirmed, RECOVERING retains the pod identity and blocks replacement.
  try { await teardown(ports, key, runtime, detail); }
  catch { /* teardown persisted RECOVERING, or another fenced operation won; never touch its pod. */ }
}
