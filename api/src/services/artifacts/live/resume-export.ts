import type { LivePorts } from './ports';
import { assertFence, automaticEligible, conflict, LiveError, publicationBaseline, type LiveKey, type LiveRuntime } from './records';
import { currentBinding, failed, observeHead, teardown, transition } from './transitions';

/** Scheduler continuation after an API crash or retained-output transport failure.
 * Only a backend with a durable export intent opts in; Kubernetes keeps its existing path.
 */
export async function resumeRetainedExport(ports: LivePorts, key: LiveKey, runtime: LiveRuntime) {
  const attempt = runtime.attempt;
  if (!attempt || !await ports.worker.pendingBuild?.(runtime)) return;
  try {
    if (runtime.phase === 'BUILDING') {
      const candidate = await ports.worker.build(runtime, attempt);
      runtime = await transition(ports, key, runtime, state => {
        if (state.runtime.phase !== 'BUILDING' || state.runtime.pendingWake || state.runtime.attempt?.id !== attempt.id) conflict('stale_fence');
        state.runtime.phase = 'VERIFYING'; state.runtime.attempt.candidateDigest = candidate.candidateDigest;
      });
    }
    await ports.worker.verify(runtime, runtime.attempt!);
    const head = await observeHead(ports, key, runtime);
    if (attempt.kind === 'idle' && head !== attempt.headSha) throw new LiveError('git_head_moved');
    if (attempt.kind === 'explicit' && !await ports.forge.reachable(key, attempt.headSha)) throw new LiveError('git_head_moved');
    runtime = await ports.store.transaction(key, async unit => {
      assertFence(unit.state, runtime);
      const state = unit.state; const binding = await currentBinding(ports, key, runtime.generation);
      if (state.runtime.phase !== 'VERIFYING' || state.runtime.pendingWake || state.runtime.attempt?.id !== attempt.id) conflict('stale_fence');
      if (binding.releaseId !== attempt.expectedReleaseId) throw new LiveError('pointer_conflict');
      if (attempt.kind === 'explicit' || (binding.autoPublish && binding.automaticAuthorized
        && automaticEligible(state.progress, attempt, binding.releaseCommit))) {
        state.runtime.phase = 'PUBLISHING';
        const published = await ports.publication.commit(unit, key, state.runtime.attempt, state.runtime);
        publicationBaseline(state.progress, published.releaseId);
      }
      state.runtime.phase = 'SAVING'; return structuredClone(state.runtime);
    });
    return await teardown(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') return;
    await failed(ports, key, runtime, error); throw error;
  }
}
