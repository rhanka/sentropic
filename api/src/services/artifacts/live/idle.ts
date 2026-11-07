import type { LivePorts } from './ports';
import { assertFence, automaticEligible, conflict, idleDeadline, LiveError, publicationBaseline, type LiveKey,
  type LiveRuntime, type LiveState } from './records';
import { checkpoint, currentBinding, failed, observeHead, teardown, transition } from './transitions';
import { withinPhase } from './deadline';
import { buildEvidence } from './evidence';

const idle = (ports: LivePorts, state: LiveState | undefined): state is LiveState =>
  !!state && state.runtime.phase === 'LIVE' && ports.now() > idleDeadline(state.runtime);
const stale = (error: unknown) => error instanceof LiveError && error.reason === 'stale_fence';

/** The idle reaper (A-LIVE §5.3, Amendment 1): strictly after 900 s without qualifying activity, it always ends on the
 * clean build of the last verified commit, except a draft conflict or a diverged head (immo R4). There is no absolute
 * lifetime. The live stops first, since a build is admitted only with no live on the node; the prepared pod then waits
 * durably in BUILD_QUEUED, keeping its queue position across scheduler passes and API restarts, until admitted. */
export async function idleBuild(ports: LivePorts, key: LiveKey) {
  if (!idle(ports, await ports.store.read(key))) return;
  const binding = await currentBinding(ports, key);
  let runtime = await ports.store.transaction(key, async unit => {
    if (!idle(ports, unit.state)) return;
    if (unit.state.runtime.generation !== binding.generation) conflict('stale_fence');
    unit.state.runtime.phase = 'QUIESCING'; unit.state.runtime.routeEpoch++;
    return structuredClone(unit.state.runtime);
  });
  if (!runtime) return;
  try {
    await ports.routes.revoke(key, runtime);
    await ports.worker.quiesce(runtime);
    await ports.heavy.hold(runtime.podName, { live: false });
    const draft = await checkpoint(ports, key, runtime);
    const head = await observeHead(ports, key, runtime);
    if (draft.dirty && draft.baseHeadSha !== head) throw new LiveError('git_live_draft_conflict');
    const source = await ports.forge.snapshot(key, head);
    if (source.headSha !== head) throw new LiveError('git_head_moved');
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'QUIESCING') conflict('stale_fence');
      state.runtime.phase = 'BUILDING';
      state.runtime.attempt = { id: ports.id(), kind: 'idle', headSha: head, treeSha: source.treeSha,
        startedAt: ports.now(), leaseEpoch: state.runtime.leaseEpoch, routeEpoch: state.runtime.routeEpoch,
        expectedReleaseId: binding.releaseId, progressSeq: state.progress.progressSeq,
        baselineSeq: state.progress.publicationBaselineSeq, initial: state.progress.initialUnpublishedBranchEligible };
    });
    await ports.worker.clean(runtime);
    const cache = await withinPhase(ports.cache.acquire(source, runtime));
    await ports.worker.prepare(runtime, source, cache);
    // Deliberately never call restore: the acknowledged draft remains in the trusted store.
    await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'BUILDING') conflict('stale_fence');
      state.runtime.phase = 'BUILD_QUEUED';
    });
  } catch (error) {
    if (stale(error)) return;
    await failed(ports, key, runtime, error); throw error;
  }
  return queuedBuild(ports, key);
}
/** One scheduler pass of a BUILD_QUEUED runtime: renew its ticket, and build only once the queue admits it. */
export async function queuedBuild(ports: LivePorts, key: LiveKey) {
  const runtime = (await ports.store.read(key))?.runtime;
  if (runtime?.phase !== 'BUILD_QUEUED') return;
  try { return await ports.heavy.run(runtime.podName, 'build', () => admittedBuild(ports, key, runtime), { waitMs: 0, keep: true }); }
  catch (error) { if (error instanceof LiveError && error.reason === 'queued') return; throw error; }
}
async function admittedBuild(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  try {
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'BUILD_QUEUED') conflict('stale_fence');
      state.runtime.phase = 'BUILDING';
    });
    const attempt = runtime.attempt!;
    const candidate = await withinPhase(ports.worker.build(runtime, attempt));
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'BUILDING' || state.runtime.attempt?.id !== attempt.id) conflict('stale_fence');
      state.runtime.phase = 'VERIFYING'; state.runtime.attempt.candidateDigest = candidate.candidateDigest;
      state.runtime.attempt.evidence = buildEvidence(source, cache);
    });
    await ports.worker.verify(runtime, runtime.attempt!);
    const finalHead = await observeHead(ports, key, runtime);
    if (finalHead !== attempt.headSha) throw new LiveError('git_head_moved');
    runtime = await ports.store.transaction(key, async unit => {
      assertFence(unit.state, runtime);
      const current = await currentBinding(ports, key, runtime.generation);
      const state = unit.state;
      if (state.runtime.pendingWake || state.runtime.phase !== 'VERIFYING' || state.runtime.attempt?.id !== attempt.id) conflict('stale_fence');
      if (current.releaseId !== attempt.expectedReleaseId) throw new LiveError('pointer_conflict');
      if (current.autoPublish && current.automaticAuthorized && automaticEligible(state.progress, attempt, current.releaseCommit)) {
        state.runtime.phase = 'PUBLISHING';
        // The row lock serializes finalization vs wake. Publication and baseline consumption roll back together.
        const published = await ports.publication.commit(unit, key, state.runtime.attempt, state.runtime);
        publicationBaseline(state.progress, published.releaseId);
      }
      state.runtime.phase = 'SAVING';
      return structuredClone(state.runtime);
    });
    return await teardown(ports, key, runtime);
  } catch (error) {
    if (stale(error)) return;
    await failed(ports, key, runtime, error);
    throw error;
  }
}
