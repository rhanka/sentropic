import type { DraftSnapshot, LiveBinding, LivePorts } from './ports';
import { releaseIfDormant } from './admission';
import { assertFence, conflict, LiveError, publicationBaseline, type LiveKey, type LiveRuntime } from './records';
import { enrichPodLoss, isPodCause, isTransportLoss, podName } from './pods';
import { ensureResponsivePod, notePodLoss } from './pod-probe';
import { checkpoint, currentBinding, failed, observeHead, teardown, transition } from './transitions';
import { runPhase, withinPhase } from './deadline';
import { buildEvidence } from './evidence';
import { LiveHostError, type HostJob } from '@sentropic/artifacts/live-host';

const unreconciled = (): never => conflict('binding_unreconciled');
const noAdmittedJob = (error: unknown): boolean => error instanceof LiveHostError
  && error.code === 'handoff_mismatch' && error.reason === 'job_not_pending';

/**
 * The binding of the admitted job: the reconciled view, or the admitted host job's (generation, owner)
 * recorded as the view when the host never reconciled. The returned run id seeds the build runtime's
 * session, so the host attempt fence recorded by the seed resolution still matches the run's re-resolution.
 * Only a host refusal (no admitted job) keeps `binding_unreconciled`; a transport failure propagates.
 */
async function admittedBinding(ports: LivePorts, key: LiveKey, jobId: string) {
  try { return { binding: await currentBinding(ports, key), seedRunId: undefined as string | undefined }; }
  catch (error) {
    if (!(error instanceof LiveError) || error.code !== 'git_live_conflict' || error.reason !== 'binding_unreconciled') throw error;
  }
  const previous = await ports.store.read(key);
  const runId = ports.id();
  const attempt = (previous?.runtime.leaseEpoch ?? 0) + 1;
  let job;
  try { job = await ports.publication.job(key, jobId, { runId, attempt }); }
  catch (error) { if (noAdmittedJob(error)) unreconciled(); throw error; }
  if (!job || job.jobId !== jobId) throw new LiveError('git_live_conflict', 'job_not_pending');
  // The host's job payload is the only owner source before the first reconcile; a host that does not
  // send it yet keeps the closed refusal instead of seeding a fence a later reconcile would stale.
  if (typeof job.ownerId !== 'string' || job.ownerId.length === 0) unreconciled();
  // The admitted coordinates, recorded at the job generation (R1), then the (generation, owner) view through
  // the reconciled monotonicity rules; a lost race to a concurrent live reconcile falls back to its view.
  await ports.jobBinding(key, jobId, job.generation);
  try {
    await ports.seedBinding(key, { generation: job.generation, ownerId: job.ownerId,
      liveSessionId: runId, leaseEpoch: attempt, routeEpoch: (previous?.runtime.routeEpoch ?? 0) + 1 });
  } catch (error) {
    if (!(error instanceof LiveError) || error.code !== 'git_live_conflict' || error.reason !== 'stale_session') throw error;
  }
  return { binding: await currentBinding(ports, key), seedRunId: runId };
}

/** Explicit historical publication uses one clean pod; dormant drafts never enter this worker. */
export async function buildOnly(ports: LivePorts, key: LiveKey, jobId: string) {
  const { binding, seedRunId } = await admittedBinding(ports, key, jobId);
  const draft = await ports.drafts.current(key, binding.generation);
  if (draft.generation !== binding.generation) conflict('stale_fence');
  // A build pod takes a live slot (a refusal writes no state); its clean build then waits in the node queue.
  await ports.admission.acquire(key, binding.ownerId);
  try { return await buildPod(ports, key, jobId, binding, draft, seedRunId); }
  catch (error) { await releaseIfDormant(ports, key); throw error; }
}
async function buildPod(ports: LivePorts, key: LiveKey, jobId: string, binding: LiveBinding, draft: DraftSnapshot,
  seedRunId?: string) {
  const first = await createBuildRuntime(ports, key, binding, draft, seedRunId);
  const firstJob = await resolveAttemptJob(ports, key, jobId, binding, first);
  try { return await runAttempt(ports, key, first, firstJob); }
  catch (loss) {
    // Deterministic failures are reported as-is; a lost pod or path retries once on a fresh pod before reporting.
    if (!isTransportLoss(loss)) throw loss;
    const after = await ports.store.read(key).catch(() => undefined);
    if (after?.runtime.phase !== 'DORMANT' || after.runtime.sessionId !== first.sessionId) throw loss;
    // The first teardown released the admission slot: re-acquire it so the second attempt holds one too.
    // When the retry cannot be admitted, or a concurrent revive won the fence, the pod cause is preserved.
    try { await ports.admission.acquire(key, binding.ownerId); }
    catch { throw loss; }
    let second;
    try { second = await createBuildRuntime(ports, key, binding, draft, seedRunId); }
    catch (error) {
      await releaseIfDormant(ports, key);
      throw (error instanceof LiveError && error.reason === 'pending_publication' ? loss : error);
    }
    let secondJob: HostJob;
    try { secondJob = await resolveAttemptJob(ports, key, jobId, binding, second); }
    catch (error) { await releaseIfDormant(ports, key); throw error; }
    // Same job, new attempt fence: the host re-resolves its pending job for the fresh runtime.
    return runAttempt(ports, key, second, secondJob);
  }
}
/** One build-only intent: a fresh runtime of the next lease, no pod yet. A concurrent intent wins the fence.
 * A seeded first publication reuses the seed run id as its session, so the host attempt fence recorded by
 * the seed resolution still matches the run's re-resolution in resolveAttemptJob. */
async function createBuildRuntime(ports: LivePorts, key: LiveKey, binding: LiveBinding, draft: DraftSnapshot,
  seedRunId?: string) {
  return ports.store.transaction(key, async unit => {
    if (unit.state && unit.state.runtime.phase !== 'DORMANT') conflict('pending_publication');
    const previous = unit.state;
    const runtime = { generation: binding.generation, ownerId: binding.ownerId, sessionId: seedRunId ?? ports.id(),
      phase: 'BUILD_PROVISIONING' as const, leaseEpoch: (previous?.runtime.leaseEpoch ?? 0) + 1,
      rowVersion: previous?.runtime.rowVersion ?? 0, podUid: null, podName: podName(key),
      sourceRevision: draft.revision, appliedRevision: null, baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.treeSha,
      lastAccessAt: ports.now(),
      routeEpoch: (previous?.runtime.routeEpoch ?? 0) + 1, invitationEpoch: 0, invitationExpiresAt: null,
      pendingWake: false, attempt: null };
    unit.save({ runtime, progress: previous?.progress.generation === binding.generation ? previous.progress : {
      generation: binding.generation, latestVerifiedHeadSha: binding.headSha, progressSeq: 0,
      publicationBaselineHeadSha: binding.headSha, publicationBaselineSeq: 0, lastProgressEventId: null,
      lastSuccessfulReleaseId: null, initialUnpublishedBranchEligible: binding.initialUnpublishedBranchEligible,
    } });
    return structuredClone(unit.state!.runtime);
  });
}
/** Only the binding's pending job at this generation; the host records this run's attempt fence. */
async function resolveAttemptJob(ports: LivePorts, key: LiveKey, jobId: string, binding: LiveBinding,
  runtime: LiveRuntime): Promise<HostJob> {
  try {
    const job = await ports.publication.job(key, jobId, { runId: runtime.sessionId, attempt: runtime.leaseEpoch });
    if (job.jobId !== jobId || job.generation !== binding.generation) throw new LiveError('git_live_conflict', 'job_not_pending');
    // R1: the job's own binding, recorded at job.generation (the runtime generation every forge read resolves).
    await ports.jobBinding(key, jobId, job.generation);
    if (!await ports.forge.reachable(key, job.headSha)) throw new LiveError('git_head_moved');
    return job;
  } catch (error) {
    await transition(ports, key, runtime, state => {
      state.runtime.phase = 'DORMANT'; state.runtime.stateDetail = error instanceof LiveError
        ? (error.reason ? `${error.code}:${error.reason}` : error.code) : 'builder_unavailable';
    });
    throw error;
  }
}
/** One build-only attempt on its runtime: enriches a lost pod or path with the Kubernetes cause, tears the
 * attempt down (the pod is deleted, never left behind), and reports. The caller retries a transport loss once. */
async function runAttempt(ports: LivePorts, key: LiveKey, runtime: LiveRuntime, job: HostJob) {
  try {
    await checkpoint(ports, key, runtime);
    const pod = await ports.heavy.pod(runtime.podName, () => ensureResponsivePod(ports, key, runtime));
    runtime = await transition(ports, key, runtime, state => {
      state.runtime.podUid = pod.uid;
      if (pod.replaced) state.runtime.routeEpoch++;
    });
    const source = await ports.forge.snapshot(key, job.headSha);
    if (source.headSha !== job.headSha) throw new LiveError('git_head_moved');
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'BUILD_PROVISIONING') conflict('stale_fence');
      state.runtime.phase = 'BUILDING';
      state.runtime.attempt = { id: job.jobId, kind: 'explicit', headSha: job.headSha, treeSha: source.treeSha,
        startedAt: ports.now(), leaseEpoch: runtime.leaseEpoch, routeEpoch: runtime.routeEpoch,
        expectedReleaseId: job.expectedReleaseId, progressSeq: state.progress.progressSeq,
        baselineSeq: state.progress.publicationBaselineSeq, initial: false };
    });
    await ports.worker.clean(runtime);
    const cache = await runPhase(key, 'install', () => ports.cache.acquire(source, runtime));
    await runPhase(key, 'prepare', () => ports.worker.prepare(runtime, source, cache));
    const building = runtime;
    const candidate = await ports.heavy.run(building.podName, 'build', () => runPhase(key, 'build',
      () => withinPhase(ports.worker.build(building, building.attempt!))));
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'BUILDING' || state.runtime.pendingWake) conflict('stale_fence');
      state.runtime.phase = 'VERIFYING'; state.runtime.attempt!.candidateDigest = candidate.candidateDigest;
      state.runtime.attempt!.evidence = buildEvidence(source, cache);
    });
    await runPhase(key, 'verify', () => ports.worker.verify(runtime, runtime.attempt!));
    await observeHead(ports, key, runtime);
    runtime = await ports.store.transaction(key, async unit => {
      assertFence(unit.state, runtime);
      const current = await currentBinding(ports, key, runtime.generation);
      if (unit.state.runtime.phase !== 'VERIFYING' || unit.state.runtime.pendingWake
        || !await ports.forge.reachable(key, job.headSha)) conflict('stale_fence');
      if (current.releaseId !== job.expectedReleaseId) throw new LiveError('pointer_conflict');
      const published = await ports.publication.commit(unit, key, unit.state.runtime.attempt!, unit.state.runtime);
      publicationBaseline(unit.state.progress, published.releaseId);
      unit.state.runtime.phase = 'SAVING'; return structuredClone(unit.state.runtime);
    });
    return await teardown(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') return;
    const loss = await enrichPodLoss(ports.pods, key, runtime, error);
    if (loss instanceof LiveError && isPodCause(loss)) await notePodLoss(key, loss);
    await failed(ports, key, runtime, loss); throw loss;
  }
}
