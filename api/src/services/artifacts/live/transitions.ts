import type { LivePorts, LiveBinding } from './ports';
import { assertFence, conflict, LiveError, recordHead, type LiveKey, type LiveRuntime, type LiveState } from './records';
import { withinPhase } from './deadline';

/** Graceful quiesce bound in teardown: an unreachable supervisor endpoint fails fast instead of blocking
 * on the relay/TCP timeout (a wedged pod is deleted right after; quiesce is best-effort ordering). */
const QUIESCE_TIMEOUT_MS = 10_000;

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
  const draft = await ports.drafts.current(key, runtime.generation);
  if (draft.generation !== runtime.generation) conflict('stale_fence');
  await ports.drafts.checkpoint(key, draft);
  return draft;
}
/** An immutable node backend replaces the stopped physical sandbox for clean build/wake.
 * Persist that new physical identity and route fence before any worker command uses it. */
export async function cleanRuntime(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  const cleaned = await ports.worker.clean(runtime);
  if (!cleaned || cleaned.uid === runtime.podUid) return runtime;
  return transition(ports, key, runtime, state => {
    state.runtime.podUid = cleaned.uid; state.runtime.routeEpoch++;
    if (state.runtime.attempt) state.runtime.attempt.routeEpoch = state.runtime.routeEpoch;
  });
}
/** Always retain the old pod fence until its deletion has been confirmed. A stop or recover without its own detail
 * preserves the root cause instead of clearing it. */
export async function teardown(ports: LivePorts, key: LiveKey, runtime: LiveRuntime, detail?: string) {
  runtime = await transition(ports, key, runtime, state => {
    state.runtime.routeEpoch++; state.runtime.phase = 'SAVING'; state.runtime.stateDetail = detail ?? state.runtime.stateDetail;
  });
  await ports.routes.revoke(key, runtime);
  try {
    // A gone, terminal or terminating pod cannot answer the supervisor, and no command ever reached a pod whose
    // uid was never recorded (quiesce would fail in admit before pods.remove). Only an active pod of a recorded
    // uid is quiesced, bounded well below the relay timeout; a failed graceful quiesce never vetoes the deletion.
    // An unreadable apiserver fails closed to quiescing.
    let quiesce = runtime.podUid !== null;
    try { if (quiesce) quiesce = (await ports.pods.probe(key, runtime)) === 'active'; }
    catch (error) { if (!(error instanceof LiveError) || error.code !== 'builder_unavailable') throw error; }
    if (quiesce) {
      try { await withinPhase(ports.worker.quiesce(runtime), QUIESCE_TIMEOUT_MS); }
      catch (error) { if (!(error instanceof LiveError) || error.code !== 'builder_unavailable') throw error; }
    }
    // The process tree is gone: the live reservation and any queued or admitted phase of this pod leave the node queue.
    await ports.heavy.hold(runtime.podName, { live: false }); await ports.heavy.cancel(runtime.podName);
    await checkpoint(ports, key, runtime);
    runtime = await transition(ports, key, runtime, state => { state.runtime.phase = 'DECOMMISSIONING'; });
    await ports.pods.remove(key, runtime);
    await ports.heavy.hold(runtime.podName, { pod: false });
  } catch (error) {
    const cause = error instanceof LiveError ? (error.reason ? `${error.code}:${error.reason}` : error.code)
      : 'builder_unavailable';
    await transition(ports, key, runtime, state => {
      state.runtime.phase = 'RECOVERING'; state.runtime.stateDetail ??= cause;
    });
    throw error;
  }
  return transition(ports, key, runtime, state => {
    state.runtime.phase = 'DORMANT'; state.runtime.podUid = null;
    state.runtime.appliedRevision = null; state.runtime.attempt = null;
  }).then(async dormant => { await ports.admission.release(key); return dormant; });
}
/** The runtime a failed intent actually left behind. Prepare may fence forward (a replaced pod bumps
 * routeEpoch) after the caller captured its handle; tearing down with the stale handle would fence-fail
 * and strand the runtime in REVIVING next to a live pod. A different session means another intent won:
 * keep the caller's handle so the teardown fences out without touching the winner. */
export async function currentRuntime(ports: Pick<LivePorts, 'store'>, key: LiveKey,
  runtime: LiveRuntime): Promise<LiveRuntime> {
  const stored = await ports.store.read(key).catch(() => undefined);
  const next = stored?.runtime;
  return next && next.generation === runtime.generation && next.sessionId === runtime.sessionId ? next : runtime;
}
export async function failed(ports: LivePorts, key: LiveKey, runtime: LiveRuntime, error: unknown) {
  const detail = error instanceof LiveError ? (error.reason ? `${error.code}:${error.reason}` : error.code)
    : 'builder_unavailable';
  // If checkpoint/deletion cannot be confirmed, RECOVERING retains the pod identity and blocks replacement.
  try { await teardown(ports, key, runtime, detail); }
  catch { /* teardown persisted RECOVERING, or another fenced operation won; never touch its pod. */ }
}
